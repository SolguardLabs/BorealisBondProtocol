import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ignored = new Set([".git", "coverage", "dist", "node_modules", "private"]);
const totals = { typescript: 0, support: 0, all: 0 };

function visit(directory) {
    for (const entry of readdirSync(directory)) {
        if (ignored.has(entry)) continue;
        const path = join(directory, entry);
        if (relative(root, path).replaceAll("\\", "/").startsWith("tests/private/")) continue;
        const stat = statSync(path);
        if (stat.isDirectory()) {
            visit(path);
            continue;
        }
        const extension = extname(entry);
        if (extension !== ".ts" && extension !== ".mjs") continue;
        const lines = readFileSync(path, "utf8")
            .split(/\r?\n/)
            .filter((line) => line.trim()).length;
        totals.all += lines;
        if (extension === ".ts") totals.typescript += lines;
        else totals.support += lines;
    }
}

visit(root);
console.log(JSON.stringify(totals));
