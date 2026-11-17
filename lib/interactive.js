"use strict";

const fs = require("node:fs");
const readline = require("node:readline");
const { RuntimeError } = require("./fsutil");
const { paint } = require("./output");

function readLineSync() {
  const bytes = [];
  const buffer = Buffer.alloc(1);
  while (true) {
    const count = fs.readSync(0, buffer, 0, 1, null);
    if (!count || buffer[0] === 10) break;
    if (buffer[0] !== 13) bytes.push(buffer[0]);
  }
  return Buffer.from(bytes).toString("utf8");
}

function isInteractive(io = {}) {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  return Boolean(input.isTTY && output.isTTY);
}

function requireTerminal(io) {
  if (!isInteractive(io)) throw new RuntimeError("互動式操作需要在終端機中執行；請改用對應的子指令與 --yes");
}

// Ctrl-C inside a prompt ends the whole interactive session.
class Interrupted extends Error {}

// Runs one keypress-driven prompt. `render` returns the lines to draw and
// `onKey` returns undefined to keep going or { value } to finish. The
// terminal is always restored, whether the prompt finishes, is cancelled, or
// is interrupted.
function prompt({ input = process.stdin, output = process.stdout, render, onKey }) {
  return new Promise((resolve, reject) => {
    let drawn = 0;
    const raw = typeof input.setRawMode === "function";
    const draw = () => {
      const lines = render();
      if (drawn) output.write(`\x1b[${drawn}A\x1b[0J`);
      output.write(`${lines.join("\n")}\n`);
      drawn = lines.length;
    };
    const finish = (settle) => {
      input.removeListener("keypress", handler);
      if (raw) input.setRawMode(false);
      if (typeof input.pause === "function") input.pause();
      output.write("\x1b[?25h");
      settle();
    };
    const handler = (text, key = {}) => {
      if (key.ctrl && key.name === "c") return finish(() => reject(new Interrupted()));
      const result = onKey(text, key);
      if (result === undefined) return draw();
      return finish(() => resolve(result.value));
    };
    readline.emitKeypressEvents(input);
    if (raw) input.setRawMode(true);
    if (typeof input.resume === "function") input.resume();
    output.write("\x1b[?25l");
    input.on("keypress", handler);
    draw();
  });
}

function moveKey(key, text) {
  if (key.name === "up" || text === "k") return -1;
  if (key.name === "down" || text === "j") return 1;
  return 0;
}

// Arrow keys or j/k move, a digit jumps, Enter picks, q or Esc cancels (null).
function select({ title, items, initial = 0, hint = "↑↓ 選擇　Enter 確認　q 返回", ...io }) {
  let index = Math.min(Math.max(initial, 0), items.length - 1);
  return prompt({
    ...io,
    render: () => [
      paint(1, title),
      ...items.map((item, position) => {
        const label = `${position < 9 ? `${position + 1}. ` : "   "}${item.label}${item.hint ? paint(2, `  ${item.hint}`) : ""}`;
        return position === index ? `${paint(36, "❯")} ${label}` : `  ${label}`;
      }),
      paint(2, hint),
    ],
    onKey: (text, key) => {
      const move = moveKey(key, text);
      if (move) index = (index + move + items.length) % items.length;
      else if (/^[1-9]$/.test(text ?? "") && Number(text) <= items.length) return { value: items[Number(text) - 1].value };
      else if (key.name === "return") return { value: items[index].value };
      else if (key.name === "escape" || text === "q") return { value: null };
      return undefined;
    },
  });
}

// Space toggles, Enter confirms the checked values, q or Esc cancels (null).
function checklist({ title, items, ...io }) {
  const checked = items.map((item) => Boolean(item.checked));
  let index = 0;
  return prompt({
    ...io,
    render: () => [
      paint(1, title),
      ...items.map((item, position) => {
        const box = checked[position] ? paint(32, "[x]") : "[ ]";
        const line = `${box} ${item.label}${item.hint ? paint(2, `  ${item.hint}`) : ""}`;
        return position === index ? `${paint(36, "❯")} ${line}` : `  ${line}`;
      }),
      paint(2, "↑↓ 選擇　空白鍵 勾選　Enter 確認　q 取消"),
    ],
    onKey: (text, key) => {
      const move = moveKey(key, text);
      if (move) index = (index + move + items.length) % items.length;
      else if (key.name === "space" || text === " ") checked[index] = !checked[index];
      else if (key.name === "return") return { value: items.filter((_, position) => checked[position]).map((item) => item.value) };
      else if (key.name === "escape" || text === "q") return { value: null };
      return undefined;
    },
  });
}

// Defaults to cancel so a stray Enter never applies changes.
async function confirm({ message, yesLabel, ...io }) {
  const answer = await select({ ...io, title: message, items: [{ label: "取消", value: false }, { label: yesLabel, value: true }], hint: "↑↓ 選擇　Enter 確認" });
  return answer === true;
}

function pause(io = {}) {
  return prompt({ ...io, render: () => [paint(2, "按任意鍵返回選單…")], onKey: () => ({ value: null }) });
}

module.exports = { Interrupted, checklist, confirm, isInteractive, pause, readLineSync, requireTerminal, select };
