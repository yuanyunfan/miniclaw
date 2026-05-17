#!/usr/bin/env python3
"""根据 ~/.miniclaw/channel-map.json 批量改 ~/.miniclaw/cron/*.yaml 的 channel: 字段 + enabled: true"""
import json, os, re
from pathlib import Path

MAP_FILE = Path(os.environ.get("MINICLAW_CHANNEL_MAP", str(Path.home() / ".miniclaw/channel-map.json")))
CRON_DIR = Path.home() / ".miniclaw/cron"

# cron job slug → channel slug 映射（决定每个 job 发到哪个频道）
JOB_TO_CHANNEL = {
    "github-trending":              "daily-github-trending",
    "daily-ai-news":                "daily-ai-news",
    "daily-ai-frontier":            "daily-ai-frontier",
    "daily-tech-radar":             "daily-tech-radar",
    "daily-arxiv-papers":           "daily-tech-radar",       # 论文也归 tech radar
    "weekly-app-trending":          "weekly-app-trending",
    "hourly-token-report":          "daily-token-dashboard",
    "us-stock-pre-market":          "daily-us-stock",
    "us-stock-post-market":         "daily-us-stock",
    "cn-stock-pre-market":          "daily-cn-stock",
    "cn-stock-ing-market":          "daily-cn-stock",
    "cn-stock-post-market":         "daily-cn-stock",
    "daily-stock-summary":          "daily-stock-summary",
    "daily-china-news":             "news-domestic",
    "daily-global-news":            "news-international",
    "daily-global-trending":        "trending",
    "daily-tldr":                   "tldr",
    "monitor-hermes-release":       "monitor-github-repo",
    "monitor-ai-insight-release":   "monitor-github-repo",
}

ch_map = json.loads(MAP_FILE.read_text())

updated = 0
skipped_no_mapping = []
for job_slug, ch_slug in JOB_TO_CHANNEL.items():
    yaml_file = CRON_DIR / f"{job_slug}.yaml"
    if not yaml_file.exists():
        skipped_no_mapping.append(f"{job_slug}.yaml 不存在")
        continue
    if ch_slug not in ch_map:
        skipped_no_mapping.append(f"{job_slug} → 频道 '{ch_slug}' 不在 .channel-map.json")
        continue

    new_channel_id = ch_map[ch_slug]
    text = yaml_file.read_text()

    # 替换 channel: "xxx"
    new_text = re.sub(r'^channel:\s*".*?"', f'channel: "{new_channel_id}"', text, count=1, flags=re.MULTILINE)
    # 替换 enabled: false → true
    new_text = re.sub(r'^enabled:\s*false.*$', 'enabled: true', new_text, count=1, flags=re.MULTILINE)
    # 移除原 enabled 的注释
    new_text = re.sub(r'^enabled: true\s*#\s*默认关.*$', 'enabled: true', new_text, count=1, flags=re.MULTILINE)

    if new_text == text:
        print(f"  [skip] {job_slug} 无改动")
        continue
    yaml_file.write_text(new_text)
    print(f"  [✓] {job_slug} → #{ch_slug} ({new_channel_id})")
    updated += 1

print(f"\n更新 {updated} 个 yaml")
if skipped_no_mapping:
    print(f"\n⚠️  {len(skipped_no_mapping)} 个跳过：")
    for s in skipped_no_mapping: print(f"  - {s}")
