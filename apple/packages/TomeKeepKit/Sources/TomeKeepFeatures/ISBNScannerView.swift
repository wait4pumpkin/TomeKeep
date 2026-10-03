#if os(iOS)
import AVFoundation
import SwiftUI
import TomeKeepMetadata
import UIKit

struct ISBNScannerView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var permissionDenied = false
    @State private var detectedBounds: CGRect?
    let onScanned: (String) -> Void

    var body: some View {
        NavigationStack {
            ZStack {
                ISBNScannerCamera(
                    continuous: false,
                    onScanned: onScanned,
                    onDetectedBoundsChanged: { detectedBounds = $0 },
                    onPermissionDenied: { permissionDenied = true }
                )
                .ignoresSafeArea()

                ScannerTargetOverlay(detectedBounds: detectedBounds)

                VStack {
                    Spacer()
                    Text("将书背条码放入框内")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(.black.opacity(0.58), in: .capsule)
                        .padding(.bottom, 28)
                }
            }
            .navigationTitle("扫描 ISBN")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            }
        }
        .alert("无法使用相机", isPresented: $permissionDenied) {
            Button("好", role: .cancel) { dismiss() }
        } message: {
            Text("请在“设置”中允许 TomeKeep 使用相机，或返回手工输入 ISBN。")
        }
    }
}

struct ISBNScannerCamera: UIViewControllerRepresentable {
    let continuous: Bool
    let onScanned: (String) -> Void
    let onDetectedBoundsChanged: (CGRect?) -> Void
    let onPermissionDenied: () -> Void

    func makeUIViewController(context: Context) -> CameraScannerViewController {
        CameraScannerViewController(
            continuous: continuous,
            onScanned: onScanned,
            onDetectedBoundsChanged: onDetectedBoundsChanged,
            onPermissionDenied: onPermissionDenied
        )
    }

    func updateUIViewController(_ uiViewController: CameraScannerViewController, context: Context) {}
}

struct ScannerTargetOverlay: View {
    let detectedBounds: CGRect?

    var body: some View {
        GeometryReader { proxy in
            if let detectedBounds, detectedBounds.width > 0, detectedBounds.height > 0 {
                RoundedRectangle(cornerRadius: 10)
                    .stroke(.green, lineWidth: 4)
                    .frame(width: detectedBounds.width, height: detectedBounds.height)
                    .position(x: detectedBounds.midX, y: detectedBounds.midY)
                    .shadow(color: .black.opacity(0.35), radius: 5)
            } else {
                RoundedRectangle(cornerRadius: 18)
                    .stroke(.white, style: StrokeStyle(lineWidth: 3, dash: [12, 8]))
                    .frame(width: min(310, proxy.size.width - 40), height: 150)
                    .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
                    .shadow(color: .black.opacity(0.45), radius: 8)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

@MainActor
final class CameraScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let sessionBox = CaptureSessionBox()
    private let sessionQueue = DispatchQueue(label: "com.tomekeep.camera-session", qos: .userInitiated)
    private var session: AVCaptureSession { sessionBox.value }
    private let continuous: Bool
    private let onScanned: (String) -> Void
    private let onDetectedBoundsChanged: (CGRect?) -> Void
    private let onPermissionDenied: () -> Void
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var scanSession = ISBNScanSession()
    private var detectionGeneration = 0

    init(
        continuous: Bool,
        onScanned: @escaping (String) -> Void,
        onDetectedBoundsChanged: @escaping (CGRect?) -> Void,
        onPermissionDenied: @escaping () -> Void
    ) {
        self.continuous = continuous
        self.onScanned = onScanned
        self.onDetectedBoundsChanged = onDetectedBoundsChanged
        self.onPermissionDenied = onPermissionDenied
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureForCurrentAuthorization()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        let sessionBox = sessionBox
        sessionQueue.async {
            if sessionBox.value.isRunning { sessionBox.value.stopRunning() }
        }
    }

    private func configureForCurrentAuthorization() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: configureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                Task { @MainActor in
                    guard let self else { return }
                    if granted { self.configureSession() } else { self.onPermissionDenied() }
                }
            }
        default: onPermissionDenied()
        }
    }

    private func configureSession() {
        guard let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera),
              session.canAddInput(input)
        else { onPermissionDenied(); return }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { onPermissionDenied(); return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.ean13, .ean8]

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        previewLayer = layer
        layer.frame = view.bounds
        let sessionBox = sessionBox
        sessionQueue.async { sessionBox.value.startRunning() }
    }

    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard let readable = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let value = readable.stringValue
        else { return }
        let readableBox = MetadataObjectBox(readable)
        MainActor.assumeIsolated { [weak self] in
            guard let self else { return }
            if let transformed = self.previewLayer?.transformedMetadataObject(for: readableBox.value) {
                self.publishDetectedBounds(transformed.bounds)
            }
            guard case .accepted(let normalized) = self.scanSession.accept(value) else { return }
            if !self.continuous {
                let sessionBox = self.sessionBox
                self.sessionQueue.async {
                    if sessionBox.value.isRunning { sessionBox.value.stopRunning() }
                }
            }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            self.onScanned(normalized)
        }
    }

    private func publishDetectedBounds(_ bounds: CGRect) {
        detectionGeneration += 1
        let generation = detectionGeneration
        onDetectedBoundsChanged(bounds)
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard let self, self.detectionGeneration == generation else { return }
            self.onDetectedBoundsChanged(nil)
        }
    }
}

/// AVCaptureSession owns its own serialization internally. The box lets its
/// dedicated queue start and stop capture without blocking the main actor.
private final class CaptureSessionBox: @unchecked Sendable {
    let value = AVCaptureSession()
}

/// The metadata delegate is configured on the main queue, but AVFoundation's
/// Objective-C protocol does not express that isolation to Swift 6.
private final class MetadataObjectBox: @unchecked Sendable {
    let value: AVMetadataObject

    init(_ value: AVMetadataObject) {
        self.value = value
    }
}
#endif
