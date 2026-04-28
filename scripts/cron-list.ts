#!/usr/bin/env tsx
// 列出所有 cron job 状态
// 用法: pnpm cron:list
import cron from "node-cron";
import { loadCronJobs } from "../src/cron/loader.js";

const { jobs, errors } = loadCronJobs();

console.log(`\n📅 ~/.miniclaw/cron/ — ${jobs.length} job(s) loaded`);
console.log("─".repeat(72));

if (jobs.length === 0) {
  console.log("(无)");
} else {
  for (const j of jobs) {
    const status = j.enabled ? "✅" : "⏸ ";
    const tz = j.timezone ? ` tz=${j.timezone}` : "";
    let tail = "";
    if (j.type === "task") tail = `prompt: ${j.prompt.slice(0, 40)}${j.prompt.length > 40 ? "..." : ""}`;
    else if (j.type === "script") tail = `script: ${j.script}`;
    else if (j.type === "skill") tail = `skill: ${j.skill}`;
    else if (j.type === "message") tail = `msg: ${j.content.slice(0, 40)}${j.content.length > 40 ? "..." : ""}`;
    const valid = cron.validate(j.schedule);
    const validTag = valid ? "" : " ⚠️ invalid schedule";
    console.log(`${status} ${j.name.padEnd(20)} ${j.type.padEnd(8)} "${j.schedule}"${tz}${validTag}`);
    console.log(`     #${j.channel}  ${tail}`);
  }
}

console.log("─".repeat(72));

if (errors.length) {
  console.log(`\n⚠️  ${errors.length} 个加载失败:`);
  for (const e of errors) console.log(`   ${e.file}: ${e.error}`);
}
