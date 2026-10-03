// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "TomeKeepKit",
    defaultLocalization: "zh-Hans",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "TomeKeepDomain", targets: ["TomeKeepDomain"]),
        .library(name: "TomeKeepPersistence", targets: ["TomeKeepPersistence"]),
        .library(name: "TomeKeepNetworking", targets: ["TomeKeepNetworking"]),
        .library(name: "TomeKeepSync", targets: ["TomeKeepSync"]),
        .library(name: "TomeKeepMetadata", targets: ["TomeKeepMetadata"]),
        .library(name: "TomeKeepPricing", targets: ["TomeKeepPricing"]),
        .library(name: "TomeKeepDesignSystem", targets: ["TomeKeepDesignSystem"]),
        .library(name: "TomeKeepFeatures", targets: ["TomeKeepFeatures"]),
        .library(name: "TomeKeepMigration", targets: ["TomeKeepMigration"]),
        .executable(name: "tomekeep-migration-audit", targets: ["TomeKeepMigrationAudit"]),
    ],
    targets: [
        .target(name: "TomeKeepDomain"),
        .target(
            name: "TomeKeepPersistence",
            dependencies: ["TomeKeepDomain"]
        ),
        .target(
            name: "TomeKeepNetworking",
            dependencies: ["TomeKeepDomain"],
            linkerSettings: [.linkedFramework("Security")]
        ),
        .target(
            name: "TomeKeepSync",
            dependencies: [
                "TomeKeepDomain",
                "TomeKeepPersistence",
                "TomeKeepNetworking",
            ]
        ),
        .target(
            name: "TomeKeepMetadata",
            dependencies: ["TomeKeepDomain"]
        ),
        .target(
            name: "TomeKeepPricing",
            dependencies: ["TomeKeepDomain"],
            resources: [.process("Resources")]
        ),
        .target(name: "TomeKeepDesignSystem"),
        .target(
            name: "TomeKeepMigration",
            dependencies: ["TomeKeepDomain"]
        ),
        .executableTarget(
            name: "TomeKeepMigrationAudit",
            dependencies: ["TomeKeepMigration", "TomeKeepPersistence"]
        ),
        .target(
            name: "TomeKeepFeatures",
            dependencies: [
                "TomeKeepDomain",
                "TomeKeepPersistence",
                "TomeKeepNetworking",
                "TomeKeepSync",
                "TomeKeepMetadata",
                "TomeKeepPricing",
                "TomeKeepDesignSystem",
                "TomeKeepMigration",
            ],
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "TomeKeepDomainTests",
            dependencies: ["TomeKeepDomain"]
        ),
        .testTarget(
            name: "TomeKeepMetadataTests",
            dependencies: ["TomeKeepMetadata"]
        ),
        .testTarget(
            name: "TomeKeepPricingTests",
            dependencies: ["TomeKeepDomain", "TomeKeepPricing"]
        ),
        .testTarget(
            name: "TomeKeepPersistenceTests",
            dependencies: ["TomeKeepDomain", "TomeKeepPersistence"]
        ),
        .testTarget(
            name: "TomeKeepNetworkingTests",
            dependencies: ["TomeKeepNetworking"]
        ),
        .testTarget(
            name: "TomeKeepSyncTests",
            dependencies: ["TomeKeepNetworking", "TomeKeepSync"]
        ),
        .testTarget(
            name: "TomeKeepMigrationTests",
            dependencies: ["TomeKeepMigration"]
        ),
        .testTarget(
            name: "TomeKeepFeaturesTests",
            dependencies: ["TomeKeepFeatures"]
        ),
    ]
)
