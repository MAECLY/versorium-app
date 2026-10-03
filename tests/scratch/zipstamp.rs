// Scratch probe: does zip 5.1.1 (default features, `time` on) stamp entries
// with the current wall clock, making two archives of identical bytes differ?
use std::io::Write;
fn build(path: &str, body: &[u8]) {
    let f = std::fs::File::create(path).unwrap();
    let mut z = zip::ZipWriter::new(f);
    let o = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    z.start_file("chapters/ch-01.md", o).unwrap();
    z.write_all(body).unwrap();
    z.finish().unwrap();
}
fn main() {
    let dir = std::env::temp_dir();
    let a = dir.join("vzs-a.zip");
    let b = dir.join("vzs-b.zip");
    build(a.to_str().unwrap(), b"La luz giraba sobre el agua.");
    std::thread::sleep(std::time::Duration::from_secs(3));
    build(b.to_str().unwrap(), b"La luz giraba sobre el agua.");
    let ba = std::fs::read(&a).unwrap();
    let bb = std::fs::read(&b).unwrap();
    println!("identical bytes: {}", ba == bb);
    println!("len a={} b={}", ba.len(), bb.len());
    let za = zip::ZipArchive::new(std::fs::File::open(&a).unwrap()).unwrap();
    println!("entry 0 mtime a: {:?}", za.file_names().count());
    let mut za = zip::ZipArchive::new(std::fs::File::open(&a).unwrap()).unwrap();
    let e = za.by_index(0).unwrap();
    println!("last_modified: {:?}", e.last_modified());
}
