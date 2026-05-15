---
doc_id: agent-runtime-contracts-plan
lang: zh
translation_of: docs/plans/2026-05-11-agent-runtime-contracts.md
translation_status: current
source_sha256: 8a4b194abf85514977d49fb98c40a53c1a7e8981628509978ff6e903af475bc1
---
# 代理运行时间, 模型客户端, IM Transport, 和数据提供者合同

现况:已完成
日期:2026-05-11

## 背景情况

MiniClaw 目前在周围转换行为`AgentProvider = "claude" | "codex"`。多个区域分支`config.agentProvider`,包括任务执行,聊天,阶段,路由 LLM 调用,会话验证,以及运行时配置显示.

这对两个编码代理后端有效,但抽象是品牌而非能力. 如果MiniClaw后来添加了Hermes Agent,OpenClaw,一个用于分类,Telegram,Slack,Teams的普通模型API,或者额外的数据提供者,品牌分支将会扩散.

目标是能力合同:

- `AgentRuntime`:经工作空间许可和会话语义进行长期编码/任务执行.
- `ModelClient`:短的非工作空间 LLM 调用路由器,摘要,诊断,格式化.
- `IMTransport`:发送,编辑,线程,按钮,文件上传,速率限制以及权限检查等表层操作信息.
- `DataProvider`: WeChat,电子邮件,Futu,Eastmoney,市场数据,以及类似的定型数据收集.

## 目标

- 在不打破Claude/Codex目前行为的情况下,采用面向能力的合同。
- 留着`agentProvider`作为过渡期间的后向兼容配置别名.
- 确保为路由器/医生添加一个普通LLM API,不需要假装它是一个编码代理运行时间.
- 确保增加一个综合管理运输工具,不需要更换Claude/Codex跑车。
- 将数据提供者与AI提供者分开。

## 非目标

- 不要建立一个通用的代理平台。
- 不在一个会话中迁移所有呼叫站点。
- 不要在此片中添加Telegram/Slack/Teams.
- 在兼容性和docs准备好之前,不要删除 Claude/Codex 配置密钥 。
- 不默认执行多代理的任务。

## 现有建筑证据

- `src/config.ts`: 出口`AgentProvider`单曲`config.agentProvider`.
- `src/agent/session.ts`:格式并验证提供者前置会话编号。
- `src/agent/task.ts`: 提供者特定任务执行分支.
- `src/agent/chat.ts`:提供商特有的聊天行为.
- `src/agent/runtime-config.ts`:显示当前提供者/模型/运行时间设置。
- `src/routing/llm.ts`: 分类/模式路径与当前配置绑定.
- `src/stage/agent.ts`: 当前提供者上的阶段路径分支。
- `src/providers/types.ts`:数据提供前合同目前不相关,但很薄。

## 拟议合同

### `AgentRuntime`

```ts
export interface AgentRuntime {
  id: string;
  kind: "coding_agent";
  capabilities: {
    resumeSession: boolean;
    cancel: boolean;
    toolEvents: boolean;
    workspaceWrite: boolean;
  };
  startTask(input: AgentTaskInput): Promise<AgentTaskResult>;
  resumeTask?(input: AgentTaskResumeInput): Promise<AgentTaskResult>;
  startChat?(input: AgentChatInput): Promise<AgentChatResult>;
}
```

本合同应与`TaskViewEvent`和任务执行者的工作, 但第一个切片可能只定义类型 和适配器shims。

### `ModelClient`

```ts
export interface ModelClient {
  id: string;
  kind: "model_client";
  complete(input: ModelCompletionInput): Promise<ModelCompletionResult>;
  classify?<T>(input: ModelClassificationInput<T>): Promise<T>;
}
```

使用大小写 :

- 智能路由器分类器
- 自动医生总结/诊断
- 报告格式
- 不需要工作空间写权限的简短解释

### `IMTransport`

```ts
export interface IMTransport {
  id: string;
  kind: "im_transport";
  send(input: SendMessageInput): Promise<SentMessage>;
  edit(input: EditMessageInput): Promise<void>;
  createThread(input: CreateThreadInput): Promise<ThreadRef>;
  sendFile(input: SendFileInput): Promise<void>;
}
```

首先将 Discord 记录为唯一执行的运输 。 在本合同后面不要移动Discord类型,除非有具体的第二次运输或可检验性需要。

### `DataProvider`

与`AgentRuntime`和`ModelClient`。详细的提供者框架由以下内容涵盖:`2026-05-11-provider-framework-sdk.md`.

## 执行计划

1. 在中立地点增加合同类型。
- 候选人文件 :
     - `src/runtime/agent-runtime.ts`
     - `src/runtime/model-client.ts`
     - `src/runtime/im-transport.ts`
- 避免将Discord、Claude或Codex SDK类型导入合同文件。
2. 为当前供应商添加适配器shims。
   - `src/agent/runtimes/claude-runtime.ts`
   - `src/agent/runtimes/codex-runtime.ts`
- 这些可以先将已有的功能包起来.
3. 增加一个运行时间登记册。
   - `getAgentRuntime(id)`返回 Claude/Codex 运行时适配器。
   - `getDefaultAgentRuntime(config)`现有地图`config.agentProvider`到运行时间 ID。
4. 保留`config.agentProvider`作为兼容性。
- 后面添加与未来兼容的配置形状:
     - `runtime.default_agent`
     - `model.default_client`
- 不要求用户在第一个切片中重写配置 。
5. 将智能路由器和医生的短型号呼叫向`ModelClient`.
- 以现有的适配器开始`src/routing/llm.ts`.
- 不要给分类客户端工作空间权限。
6. 对齐会话id验证.
- 尽可能用运行时代号替换只提供方的假设。
- 留着`claude:<id>`和`codex:<id>`兼容性。
7. 更新运行时间配置显示 。
   - `/agent-config`应显示:
- 默认代理运行时间;
- 默认模式客户端;
- 运输;
- 只有在安全时数据提供者配置摘要。
8. 添加测试。
- 运行时注册选择。
- 配置兼容性映射。
- 会话 id 兼容性。
- ModelClient不暴露任务运行时间能力.

## 移徙战略

### 第一阶段:类型和登记

- 增加合同和登记。
- 保持所有现有的行为。
- 添加默认映射测试。

### 阶段2:任务运行时间适应器

- 内部使用登记册`executeTask`.
- 保护公众`executeTask`签名。
- 继续使用`TaskViewEvent`如果已经降落, 工作。

### 第3阶段:示范客户端适配器

- 路线智能路由器分类器和自动医生的短调`ModelClient`.
——坚持定型政策在模式客户端之外.

### 阶段4:配置形状

- 添加内容`runtime.default_agent`和`model.default_client`作为可选配置。
- 现有`agent_provider`仍然支持,并且不会发出任何错误。
- Docs显示新的首选结构

## 核查计划

- 重点测试:
- 新的运行时间登记测试。
  - `pnpm vitest run src/agent/__tests__/runtime-config.test.ts src/agent/__tests__/codex.test.ts`
- 智能路由器分类测试,如果触摸。
- 静态:
  - `pnpm run typecheck`
  - `pnpm run lint`
- 倒退:
  - `pnpm test`
  - `pnpm run build`当导出/配置形状发生变化时。

## 风险 倒车

- 风险:抽象的合同成为投机性的过度工程。
- 缓解:从现有的Claude/Codex行为开始;只迁移混凝土呼叫站点。
- 风险:配置兼容破解运行的机器人。
- 缓解:保留旧的配置密钥和测试;不要求新的密钥。
- 风险:`ModelClient`意外获得工作空间/ 工具权限 。
- 缓解:单独类型和模块;不重复使用`AgentRuntime`为分类电话。
- 风险:运输抽象会减缓Discord的工作。
- 缓解:文件Discord是唯一的运输,直到有真正的第二运输。

## 文档同步

- 最新情况`docs/architecture.md`运行时间段 。
- 最新情况`docs/archive/features/03-discord-task-output.md`只有Discord边界改变。
- 何时更新配置示例`runtime.default_agent` or `model.default_client`现予接受。
- 运行`pnpm run quality:docs`.

## 执行笔记

在此记录哪个阶段落地, 兼容行为, 以及执行时的校验命令 。

- 2026-05-12:登陆第一阶段合同和登记。 添加中性`AgentRuntime`, `ModelClient`,以及`IMTransport`合同类型;增加Claude/Codex`AgentRuntime`适配器 shims 凌驾于现有任务执行器之上; 添加带有遗留问题的运行时记录器`agentProvider`默认映射和未来形状`runtime.default_agent`解析帮助器; 将当前过渡边界记录在`docs/architecture.md`。现有任务执行仍然通过旧路径选择运行者;没有行为迁移到`executeTask`发生在这个阶段。
- 核查:`pnpm vitest run src/agent/__tests__/runtime-registry.test.ts src/runtime/__tests__/contracts.test.ts`; `pnpm run typecheck`; `pnpm vitest run src/agent/__tests__/runtime-config.test.ts src/agent/__tests__/codex.test.ts`; `pnpm run lint`; `pnpm run quality:docs`; `pnpm run build`; `pnpm test`在早先的一次平行核查努力中,`pnpm test`击打 DB 重型套房中的瞬间 SQLite 迁移锁/ 独特错误; 直接重运行这些套房, 然后重运行全数`pnpm test`通过。
- 2026-05-12:着陆 第二阶段任务运行时适配电线.`executeTask`现在解决选中的`AgentRuntime`通过运行时间注册和调用`runtime.startTask`在保护公众的同时`executeTask`签名、 Discord 任务视图处理、取消/中断正常化、 DB 补全更新以及原始/嵌入式输出模式。 E2E 假任务执行现在将选中的运行时间 ID 包裹在同一处`AgentRuntime`而不是绕过旧的跑者选择器的运行时间边界。 更新架构/任务输出文件以反映新的运行时间选择边界 。
- 核查:`pnpm vitest run src/agent/__tests__/task-runtime-registry.test.ts src/agent/__tests__/task-helpers.test.ts src/agent/__tests__/runtime-registry.test.ts src/agent/__tests__/e2e-fake-runtime.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm test`(144份文件,718项测试);`pnpm run quality:docs`.
- 2026-05-12:着陆阶段3 智能路由器`ModelClient`适配电线. 为 Anthropic 兼容信件、 OpenAI 兼容聊天补全和只读 Codex 线程补全添加提供者中立模式客户端适配器;`src/routing/llm.ts`现在通过`ModelClient`合同,而不是直接拥有供应商SDK。 保留现有的分类提供者选择,模型继承,OpenAI系统即时,JSON响应格式,超时行为,可选的代码折返,以及只读/无网络代码分类器边界. Auto Doctor目前没有简短的LLM调用路径可以迁移,因此Docs现在声明明确而非暗示隐藏的医生模型客户端路径.
- 核查:`pnpm vitest run src/routing/__tests__/llm.test.ts src/runtime/__tests__/contracts.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run quality:docs`; `pnpm run build`; `pnpm test`(144档案,719检验).
- 2026-05-12:着陆 第四阶段配置形状和运行时显示线条. 添加可选`runtime.default_agent` / `MINICLAW_RUNTIME_DEFAULT_AGENT`和`model.default_client` / `MINICLAW_MODEL_DEFAULT_CLIENT`在保留遗产的同时配置支持`agent.provider`作为后退的别名。 智能路由器 LLM 提供者选择现在返回到`model.default_client`除非配置了路由器指定提供者。 任务接收,`/resume`,线程延续,以及`/health`现在使用有效默认`AgentRuntime`用于任务显示和会话飞行前检查。`/agent-config`现在显示默认的 AgentRuntime, 遗留的提供者别名, ModelClient 默认/router 客户端, Discord 作为已执行的 IM Transport, 以及安全的预提供方名称 。 更新配置示例和文件,以反映已接受的配置形状和Discord任务边界。
- 核查:`pnpm vitest run src/__tests__/config.test.ts src/config/__tests__/config-boundaries.test.ts src/agent/__tests__/runtime-config.test.ts src/agent/__tests__/session.test.ts src/agent/__tests__/task-helpers.test.ts src/agent/__tests__/runtime-registry.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run quality:docs`; `pnpm run build`; `pnpm test`(144档案,719检验).
