export function riskKeyword(title: string): string | undefined {
  const checks: Array<[RegExp, string]> = [
    [/(FOMC|rate|yield|Treasury|inflation|CPI|PPI|payroll|employment|liquidity|open market|reverse repo|PMI|monetary)/i, "macro_policy_event"],
    [/(profit warning|trading halt|resumption|default|investigation|lawsuit|delisting|impairment|inside information|subpoena|bankruptcy)/i, "company_event_risk"],
    [/(停牌|复牌|业绩预告|权益变动|减持|问询|监管|处罚|诉讼|仲裁|违约|风险|重大)/i, "company_event_risk"],
  ];
  return checks.find(([pattern]) => pattern.test(title))?.[1];
}
