use std::fmt::Display;

use super::{djb2::djb2, memo_sha_256::MemoSha256};

pub enum HashAlgorithm {
    Djb2,
    None,
    Sha256,
}

impl HashAlgorithm {
    pub fn from_string(input: &String) -> Option<Self> {
        match input.as_str() {
            "sha256" => Some(HashAlgorithm::Sha256),
            "djb2" => Some(HashAlgorithm::Djb2),
            "none" => Some(HashAlgorithm::None),
            _ => None,
        }
    }
}

impl Display for HashAlgorithm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HashAlgorithm::Djb2 => write!(f, "djb2"),
            HashAlgorithm::None => write!(f, "none"),
            HashAlgorithm::Sha256 => write!(f, "sha256"),
        }
    }
}

pub struct Hashing {
    sha_hasher: MemoSha256,
}

impl Hashing {
    pub fn new() -> Self {
        Self {
            sha_hasher: MemoSha256::new(),
        }
    }

    pub fn hash(&self, input: &String, hash_algorithm: &HashAlgorithm) -> String {
        match hash_algorithm {
            HashAlgorithm::Sha256 => self.sha_hasher.hash_string(input),
            HashAlgorithm::Djb2 => djb2(input),
            HashAlgorithm::None => input.to_string(),
        }
    }

    pub fn sha256(&self, input: &String) -> String {
        self.sha_hasher.hash_string(input)
    }

    pub fn evaluation_hash(&self, input: &String) -> Option<usize> {
        self.sha_hasher.compute_hash(input)
    }
}
