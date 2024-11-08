import { getRootedPath } from '@/utils/file_utils.js';
import { Log, printTitle } from '@/utils/teminal_utils.js';
import { getRootVersion } from '@/utils/toml_utils.js';
import chalk from 'chalk';
import { Command } from 'commander';
import fs from 'fs';

export class SyncVersion extends Command {
  constructor() {
    super('sync-version');

    this.description('Sync the version across all relevant files');

    this.action(() => SyncVersion.sync());
  }

  static sync() {
    printTitle('Syncing Version');

    Log.stepBegin('Getting root version');
    const version = getRootVersion().toString();
    Log.stepEnd(`Root Version: ${version}`);

    updateStatsigMetadataVersion(version);
    updateNodePackageJsonVersion(version);
    updateJavaGradleVersion(version);

    console.log(`✅ ${chalk.green(`All Versions Updated to: ${version}`)}`);
  }
}

function updateStatsigMetadataVersion(version: string) {
  Log.stepBegin('Updating statsig_metadata.rs');

  const path = getRootedPath('statsig-lib/src/statsig_metadata.rs');
  const contents = fs.readFileSync(path, 'utf8');

  const was = contents.match(/sdk_version: "([^"]+)"/)?.[1];
  const updated = contents.replace(
    /sdk_version: "([^"]+)"/,
    `sdk_version: "${version}"`,
  );

  fs.writeFileSync(path, updated, 'utf8');

  Log.stepEnd(`Updated Version: ${chalk.strikethrough(was)} -> ${version}`);
}

function updateNodePackageJsonVersion(version: string) {
  Log.stepBegin('Updating package.json');
  const path = getRootedPath('statsig-napi/package.json');
  const contents = fs.readFileSync(path, 'utf8');

  const was = contents.match(/version": "([^"]+)"/)?.[1];
  const updated = contents.replace(
    /version": "([^"]+)"/,
    `version": "${version}"`,
  );

  fs.writeFileSync(path, updated, 'utf8');

  Log.stepEnd(`Updated Version: ${chalk.strikethrough(was)} -> ${version}`);
}

function updateJavaGradleVersion(version: string) {
  Log.stepBegin('Updating gradle.properties');

  const path = getRootedPath('statsig-ffi/bindings/java/gradle.properties');
  const contents = fs.readFileSync(path, 'utf8');

  const was = contents.match(/version=([^"]+)/)?.[1];
  const updated = contents.replace(/version=([^"]+)/, `version=${version}`);

  fs.writeFileSync(path, updated, 'utf8');

  Log.stepEnd(`Updated Version: ${chalk.strikethrough(was)} -> ${version}`);
}

/*

use std::collections::HashMap;

use crate::utils::{get_cargo_toml_version, print_title};
use colored::{Color, Colorize};
use config::{self, Config, File, FileFormat};
use serde_json::json;

pub fn execute() {
    print_title("🔄", "Syncing Versions", Color::Yellow);

    let version = get_cargo_toml_version();
    println!("Current Version: {}", version.to_string().bold());

    let statsig_metadata_version = get_statsig_metadata_version();
    set_statsig_metadata_version(version.to_string());
    println!(
        "StatsigMetadata.sdk_version: {} -> {}",
        statsig_metadata_version.bold().strikethrough(),
        version.to_string().bold()
    );

    let node_version = get_node_package_json_version();
    set_node_package_json_version(version.to_string());
    println!(
        "Node Version: {} -> {}",
        node_version.bold().strikethrough(),
        version.to_string().bold()
    );

    let java_version = get_java_gradle_version();
    set_java_gradle_version(version.to_string());
    println!(
        "Java Version: {} -> {}",
        java_version.bold().strikethrough(),
        version.to_string().bold()
    );

    print_title(
        "✅",
        &format!("All Versions Updated to: {}", version.to_string()),
        Color::Green,
    );
}

fn get_node_package_json_version() -> String {
    let file =
        std::fs::read_to_string("statsig-napi/package.json").expect("Failed to read package.json");

    let json: serde_json::Value =
        serde_json::from_str(&file).expect("Failed to parse package.json");

    json["version"].as_str().unwrap().to_string()
}

fn set_node_package_json_version(version: String) {
    let file =
        std::fs::read_to_string("statsig-napi/package.json").expect("Failed to read package.json");

    let mut json: serde_json::Value =
        serde_json::from_str(&file).expect("Failed to parse package.json");

    json["version"] = json!(version);

    std::fs::write(
        "statsig-napi/package.json",
        serde_json::to_string_pretty(&json).expect("Failed to format JSON"),
    )
    .expect("Failed to write to package.json");
}

fn get_java_properties() -> HashMap<String, String> {
    let properties = Config::builder()
        .add_source(File::new(
            "statsig-ffi/bindings/java/gradle.properties",
            FileFormat::Ini,
        ))
        .build()
        .expect("Failed to build gradle.properties");

    properties
        .try_deserialize::<HashMap<String, String>>()
        .expect("Failed to deserialize gradle.properties")
}

fn get_java_gradle_version() -> String {
    let map = get_java_properties();
    map["version"].clone()
}

fn set_java_gradle_version(version: String) {
    let mut map = get_java_properties();
    map.insert("version".to_string(), version);

    // Write the updated properties back to the file
    let content = map
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<String>>()
        .join("\n");

    std::fs::write("statsig-ffi/bindings/java/gradle.properties", content)
        .expect("Failed to write to gradle.properties");
}

fn get_statsig_metadata_version() -> String {
    let path = "statsig-lib/src/statsig_metadata.rs";
    let content = std::fs::read_to_string(path).expect("Failed to read statsig_metadata.rs");
    let re = regex::Regex::new(r#"sdk_version: "([^"]+)""#).expect("Failed to create regex");
    let captures = re.captures(&content).expect("Failed to capture version");
    let version = captures.get(1).expect("Failed to get version").as_str();
    version.to_string()
}

fn set_statsig_metadata_version(version: String) {
    let path = "statsig-lib/src/statsig_metadata.rs";
    let content = std::fs::read_to_string(path).expect("Failed to read statsig_metadata.rs");

    let re = regex::Regex::new(r#"sdk_version: "([^"]+)""#).expect("Failed to create regex");
    let updated = re.replace(&content, format!(r#"sdk_version: "{}""#, version));

    std::fs::write(path, updated.to_string()).expect("Failed to write to statsig_metadata.rs");
}



*/
