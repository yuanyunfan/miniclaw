// 简易模板：{{key}} 替换为 vars[key]，未知占位符保留原文。
// 内置变量：date / weekday / time / iso
export function renderTemplate(template: string, vars: Record<string, string> = {}): string {
  const now = new Date();
  const builtins: Record<string, string> = {
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5),
    iso: now.toISOString(),
    weekday: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()],
  };
  const merged = { ...builtins, ...vars };
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    return key in merged ? merged[key] : match;
  });
}
