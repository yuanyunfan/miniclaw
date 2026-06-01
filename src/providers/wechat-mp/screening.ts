import type { WechatMpArticle, WechatMpTitleScreen } from "./types.js";

const STRONG_SIGNALS: Array<[RegExp, string, number]> = [
  [/\b(agentic|agent|multi-agent|agents?)\b|智能体|多智能体|GUI Agent/i, "agent/多智能体", 24],
  [/\bMCP\b|Model Context Protocol|隧道/i, "MCP/工具协议", 20],
  [/\bRAG\b|检索增强|知识库/i, "RAG/知识系统", 18],
  [/\bCodex\b|\bCopilot\b|AI Coding|编码|代码|工程师/i, "AI coding/工程效率", 20],
  [/\bLLM\b|大模型|模型推理|推理加速|后训练|RL后训练|RLHF|RLVR|SFT|蒸馏/i, "LLM/训练推理", 18],
  [/\bData\b|数据仓库|数据湖|湖仓|数据平台|大数据|AI-Ready|治理|DLF|Lake/i, "Data Engineering/数据平台", 24],
  [/架构|系统设计|工程实践|落地实践|案例|平台实现|自优化|自动化/i, "工程实践/架构案例", 18],
  [/评测|benchmark|性能|吞吐|延迟|成本|可观测|运维|SQL|debug/i, "可验证工程指标", 12],
];

const LIGHT_SIGNALS: Array<[RegExp, string, number]> = [
  [/\bOpenAI\b|\bAnthropic\b|\bClaude\b|\bDeepMind\b|\bGoogle\b|\b微软\b|\b阿里云\b/i, "关键 AI 厂商/平台", 8],
  [/开源|框架|工具|SDK|平台|workflow|工作流/i, "工具/框架线索", 8],
  [/研究|论文|范式|科学|数学|Erdos|Erdős/i, "研究进展", 6],
];

const TITLEBAIT_PENALTIES: Array<[RegExp, string, number]> = [
  [/重磅|泄露|疯了|一夜|掀翻|炸裂|秒杀|抢疯|永久大脑|世纪难题|火了/i, "标题党措辞", 14],
  [/狂飙|真能/i, "标题党措辞", 8],
  [/！|!|？|\?/, "强情绪标点", 4],
  [/只需要|复制粘贴|保姆级|零门槛|全网|速看/i, "低成本噱头", 8],
];

const LOW_VALUE_PENALTIES: Array<[RegExp, string, number]> = [
  [/招聘|直播|带岗|简历|报名|志愿者|招募|议题|会议|大会|回放|专家对接/i, "活动/招聘/会议信息", 32],
  [/预售|宠物|翻译器|800多块|猫狗/i, "消费级轻资讯", 22],
  [/家每一件物品|机器人时代的安卓系统|物理世界独有/i, "偏消费硬件/机器人访谈", 14],
  [/麒麟|昇腾|纳米|晶体管|半导体|制程/i, "芯片制造资讯偏离当前阅读目标", 14],
];

function addMatches(
  text: string,
  rules: Array<[RegExp, string, number]>,
  reasons: string[],
): number {
  let score = 0;
  for (const [pattern, reason, value] of rules) {
    if (!pattern.test(text)) continue;
    score += value;
    reasons.push(reason);
  }
  return score;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function screenWechatMpArticleTitle(article: Pick<WechatMpArticle, "account" | "title" | "digest">): WechatMpTitleScreen {
  const text = `${article.title}\n${article.digest ?? ""}`;
  const reasons: string[] = [];
  const penalties: string[] = [];
  let score = 18;

  score += addMatches(text, STRONG_SIGNALS, reasons);
  score += addMatches(text, LIGHT_SIGNALS, reasons);

  for (const [pattern, penalty, value] of TITLEBAIT_PENALTIES) {
    if (!pattern.test(text)) continue;
    score -= value;
    penalties.push(penalty);
  }
  for (const [pattern, penalty, value] of LOW_VALUE_PENALTIES) {
    if (!pattern.test(text)) continue;
    score -= value;
    penalties.push(penalty);
  }

  if (/InfoQ|DataFun|阿里云开发者/.test(article.account)) {
    score += 6;
    reasons.push("来源通常偏工程实践");
  }
  if (!article.digest) {
    score -= 4;
    penalties.push("缺少摘要，标题证据较弱");
  }

  const finalScore = clampScore(score);
  return {
    decision: finalScore >= 55 ? "full_read" : finalScore >= 35 ? "skim" : "skip",
    score: finalScore,
    reasons: [...new Set(reasons)].slice(0, 4),
    penalties: [...new Set(penalties)].slice(0, 4),
  };
}
