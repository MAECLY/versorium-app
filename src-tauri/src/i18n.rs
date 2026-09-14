//! Minimal server-side i18n.
//!
//! Rust commands return short error *codes* (`"io"`, `"not_found"`, …);
//! the frontend maps codes to localized copy through `locales/{en,es}`.
//! This module exists so Rust-side diagnostics can also be localized when
//! we need them (CLI output, crash logs — which never include manuscript text).

pub fn t(locale: &str, code: &str) -> String {
    let msg = match (locale, code) {
        ("es", "io") => "Error de archivo o disco.",
        ("es", "not_found") => "Proyecto no encontrado.",
        ("es", "project_exists") => "Ya existe un proyecto con ese nombre.",
        ("es", "empty_title") => "El título no puede estar vacío.",
        ("es", "no_home") => "No se pudo localizar la carpeta de documentos.",
        ("es", "unknown") => "Algo salió mal.",
        _ => match code {
            "io" => "File or disk error.",
            "not_found" => "Project not found.",
            "project_exists" => "A project with that name already exists.",
            "empty_title" => "Title cannot be empty.",
            "no_home" => "Could not locate the Documents folder.",
            _ => "Something went wrong.",
        },
    };
    msg.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localizes_known_codes() {
        assert_eq!(t("es", "io"), "Error de archivo o disco.");
        assert_eq!(t("en", "io"), "File or disk error.");
        assert_eq!(t("de", "io"), "File or disk error.");
    }
}
