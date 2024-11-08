use crate::utils::*;
use colored::*;

pub async fn execute(repo_name: &str) {
    print_title("🏷 ", "Creating GitHub Release", Color::Yellow);

    let version = get_cargo_toml_version().to_string();
    println!("Current Version: {}", version.to_string().bold());

    let octo = get_octocrab().await;
    let repo = octo.repos("statsig-io", repo_name);

    println!(
        "\nChecking if tag {} exists in {}...",
        version.to_string(),
        repo_name
    );

    if let Ok(_) = repo.releases().get_by_tag(&version).await {
        println!(
            "{}",
            format!("└── Release {} already exists", version).green()
        );

        return;
    }

    println!(
        "{}",
        format!("└── Release {} not found in {}", version, repo_name).yellow()
    );

    let is_prerelease =
        version.contains("-beta") || version.contains("-rc") || version.contains("-alpha");

    let branch_name = get_remote_branch_name_from_version();

    println!("-- Creating New Release --");
    println!("├── Repo: {}", repo_name);
    println!("├── Version: {}", version);
    println!("├── Branch: {}", branch_name);
    println!("└── Prerelease: {}", is_prerelease);

    if !check_branch_exists(repo_name, &branch_name).await {
        panic!("Branch {} not found in {}", branch_name, repo_name);
    }

    match repo
        .releases()
        .create(&version)
        .target_commitish(&branch_name)
        .prerelease(is_prerelease)
        .send()
        .await
    {
        Ok(_) => {
            println!("{}", "└── Release created successfully".green());
        }
        Err(e) => {
            println!("{}", "└── Failed to create release".red());
            eprintln!("\n{:#?}", e);
            panic!("Failed to create release");
        }
    };
}

async fn check_branch_exists(repo_name: &str, branch_name: &str) -> bool {
    if repo_name.starts_with("private-") {
        return true;
    }

    let branch_url = format!(
        "https://github.com/statsig-io/{}/tree/{}",
        repo_name, branch_name
    );

    let mut attempts = 0;
    let max_attempts = 5;
    let mut success = false;

    println!("\nChecking if branch {} exists...", branch_name);
    println!("Making requests to {}", branch_url);

    while attempts < max_attempts && !success {
        attempts += 1;
        match reqwest::get(&branch_url).await {
            Ok(response) => {
                let status = response.status().as_u16();
                println!("└── Attempt {}: Status code: {}", attempts, status);
                if status >= 200 && status < 300 {
                    success = true;
                }
            }
            Err(e) => {
                println!("└── Attempt {}: Failed to make request: {}", attempts, e);
            }
        }
        if !success && attempts < max_attempts {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }
    }

    false
}
