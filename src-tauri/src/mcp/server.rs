//! Placeholder — replaced by the JSON-RPC server.

use std::io::{BufRead, Write};

pub fn serve<R: BufRead, W: Write>(_options: super::CliOptions, _input: R, _output: W) -> i32 {
    0
}
