//! Placeholder for the Scrivener reader.

use std::path::Path;

pub fn import_file(_path: &Path) -> Result<super::Imported, String> {
    Err("unsupported_source".into())
}
