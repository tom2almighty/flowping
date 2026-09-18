// Generates the static assets the hub serves: country flags and distribution
// logos. Both are plain files rather than bundle content, so the JavaScript the
// browser downloads stays small and each asset is cached on its own.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as si from "simple-icons";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// 4:3 flags, only the ones the hub actually serves.
const flagSrc = path.join(root, "node_modules/flag-icons/flags/4x3");
const flagDst = path.join(root, "public/flags");
if (!existsSync(flagSrc)) {
  console.error("flag-icons is not installed; run bun install first");
  process.exit(1);
}
mkdirSync(flagDst, { recursive: true });
let flags = 0;
for (const f of readdirSync(flagSrc)) {
  if (f.endsWith(".svg")) {
    copyFileSync(path.join(flagSrc, f), path.join(flagDst, f));
    flags++;
  }
}

// Distribution logos, in their brand colour. The list matches the lookup table
// in src/components/os-icon.tsx.
const slugs = [
  "debian",
  "ubuntu",
  "alpinelinux",
  "centos",
  "rockylinux",
  "almalinux",
  "fedora",
  "archlinux",
  "opensuse",
  "suse",
  "redhat",
  "freebsd",
  "openbsd",
  "netbsd",
  "gentoo",
  "proxmox",
  "linuxmint",
  "nixos",
  "raspberrypi",
  "kalilinux",
  "linux",
];
const osDst = path.join(root, "public/os");
mkdirSync(osDst, { recursive: true });
for (const slug of slugs) {
  const key = `si${slug[0].toUpperCase()}${slug.slice(1)}`;
  const icon = (si as unknown as Record<string, { path: string; hex: string } | undefined>)[key];
  if (!icon) {
    console.error(`simple-icons has no icon named ${key}`);
    process.exit(1);
  }
  writeFileSync(
    path.join(osDst, `${slug}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#${icon.hex}" d="${icon.path}"/></svg>\n`,
  );
}
console.log(`assets: ${flags} flags, ${slugs.length} os icons`);
