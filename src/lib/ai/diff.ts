export interface DiffLine {
  kind: "same" | "del" | "add";
  text: string;
}

/** Line diff: common prefix/suffix kept, the middle shown as del + add. */
export function lineDiff(a: string, b: string): DiffLine[] {
  const al = a.split("\n");
  const bl = b.split("\n");
  let start = 0;
  while (start < al.length && start < bl.length && al[start] === bl[start]) start++;
  let endA = al.length;
  let endB = bl.length;
  while (endA > start && endB > start && al[endA - 1] === bl[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: "same", text: al[i] });
  for (let i = start; i < endA; i++) out.push({ kind: "del", text: al[i] });
  for (let i = start; i < endB; i++) out.push({ kind: "add", text: bl[i] });
  for (let i = endA; i < al.length; i++) out.push({ kind: "same", text: al[i] });
  return out;
}
