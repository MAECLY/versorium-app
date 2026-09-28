//! Placeholder for the docx writer. Signature is the contract every format shares.

use super::Manuscript;
use std::path::Path;

pub fn export_to(_manuscript: &Manuscript, _dest: &Path) -> Result<u64, String> {
    Err("bad_format".into())
}

pub fn import_file(_path: &Path) -> Result<super::Imported, String> {
    Err("unsupported_source".into())
}
