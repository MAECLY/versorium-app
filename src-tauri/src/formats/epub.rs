//! Placeholder for the epub writer. Signature is the contract every format shares.

use super::Manuscript;
use std::path::Path;

pub fn export_to(_manuscript: &Manuscript, _dest: &Path) -> Result<u64, String> {
    Err("bad_format".into())
}
