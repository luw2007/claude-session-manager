/**
 * Wiki builder service — transforms parsed session data into a DAG-based
 * knowledge graph of Projects → Cases → Sessions → Turns → DagNodes.
 *
 * Wiki 构建服务 — 将解析后的会话数据转换为基于 DAG 的知识图谱:
 * 项目 → 案例 → 会话 → 轮次 → DAG节点
 *
 * Design notes / 设计说明:
 *  - Pure transformation: reads JSONL via the existing parseSessionFile,
 *    produces immutable wiki objects. No side effects, no disk writes.
 *  - Case detection: a new case begins when a user message contains explicit
 *    task indicators OR when a long gap (>30 min) exists between turns.
 *  - Node extraction: each assistant response is split at "section boundaries"
 *    (markdown headings, tool_use blocks, code fences) into discrete DagNodes.
 *  - Edge inference: sequential nodes within a turn are chained; nodes that
 *    reference a file previously written by another node get a dependency edge.
 *  - All URIs are stable across re-parses: wiki://{pid}/{sid}/{nodeId}
 *
 * 纯转换函数：通过现有 parseSessionFile 读取 JSONL，生成不可变 Wiki 对象。
 * 无副作用，不写磁盘。
 */

import { parseSessionFile } from '../parser/jsonl-reader.js';
import type { ParsedMessage, ContentBlock } from '../parser/message-types.js';
import type {
  DagNode,
  WikiTurn,
  WikiCase,
  WikiSession,
  WikiComponent,
  WikiGraphResponse,
} from '../parser/wiki-types.js';

// Case gap threshold: 30 minutes between turns triggers a new case
// 新案例阈值：两轮之间间隔超过 30 分钟则开启新案例
const CASE_GAP_MS = 30 * 60 * 1000;

// Minimum characters to split a text block into a separate node
// 将文本块拆分为独立节点的最小字符数
const MIN_NODE_TEXT_LEN = 80;

// ─── Text cleaning / 文本清洗 ───────────────────────────────────────────────

/**
 * Remove system-injected XML wrappers from user message text.
 * 从用户消息文本中移除系统注入的 XML 标签
 */
function cleanUserText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<bash-(?:input|stdout|stderr)>[\s\S]*?<\/bash-(?:input|stdout|stderr)>/g, '')
    .replace(/<(?:command|task|local-command)[^>]*>[\s\S]*?<\/(?:command|task|local-command)[^>]*>/g, '')
    .replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, '')
    .trim();
}

/**
 * Extract plain text from all text blocks in a message.
 * 从消息的所有文本块中提取纯文本
 */
function extractTextBlocks(content: ContentBlock[]): string {
  return content
    .filter((b): b is ContentBlock & { type: 'text'; text: string } =>
      b.type === 'text' && typeof b.text === 'string'
    )
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Detect code language from fence or file extension.
 * 从 fence 标记或文件扩展名检测代码语言
 */
function detectLanguage(fence: string, filePath?: string): string {
  if (fence) return fence.toLowerCase();
  if (!filePath) return 'text';
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', go: 'go', rs: 'rust', java: 'java',
    md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql', html: 'html', css: 'css',
  };
  return map[ext] ?? 'text';
}

// ─── Component extraction / 组件提取 ─────────────────────────────────────────

/**
 * Parse a block of markdown text into structured WikiComponents.
 * Splits on code fences, headings, and tables.
 * 将 Markdown 文本解析为结构化 WikiComponent。
 * 按代码围栏、标题、表格进行拆分。
 */
function parseTextIntoComponents(text: string): WikiComponent[] {
  const components: WikiComponent[] = [];
  const lines = text.split('\n');
  let i = 0;
  let buffer: string[] = [];

  const flushBuffer = () => {
    const chunk = buffer.join('\n').trim();
    if (chunk.length >= 10) {
      components.push({
        kind: 'text',
        content: chunk,
        length: chunk.length,
      });
    }
    buffer = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // Code fence detection / 代码围栏检测
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      flushBuffer();
      const lang = fenceMatch[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      const code = codeLines.join('\n');
      if (code.trim().length > 0) {
        components.push({
          kind: 'code',
          content: code,
          language: detectLanguage(lang),
          length: code.length,
        });
      }
      i++; // skip closing ```
      continue;
    }

    // URL detection / URL 检测
    const urlMatch = line.match(/https?:\/\/[^\s)>\]"]+/);
    if (urlMatch && line.trim().startsWith(urlMatch[0])) {
      flushBuffer();
      components.push({
        kind: 'url',
        content: urlMatch[0],
        title: line.replace(urlMatch[0], '').trim() || urlMatch[0],
        length: urlMatch[0].length,
      });
      i++;
      continue;
    }

    // Table detection / 表格检测
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].match(/^\|?[-:| ]+\|/)) {
      flushBuffer();
      const tableLines = [line];
      i++;
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const tableContent = tableLines.join('\n');
      components.push({
        kind: 'table',
        content: tableContent,
        length: tableContent.length,
      });
      continue;
    }

    buffer.push(line);
    i++;
  }

  flushBuffer();
  return components;
}

/**
 * Build WikiComponents from a ContentBlock array (one message's content).
 * 从 ContentBlock 数组构建 WikiComponent 列表（处理一条消息的内容）
 */
function buildComponents(content: ContentBlock[]): WikiComponent[] {
  const components: WikiComponent[] = [];

  for (const block of content) {
    if (block.type === 'text' && block.text) {
      components.push(...parseTextIntoComponents(block.text));
    } else if (block.type === 'tool_use') {
      const input = block.input ?? {};

      // Write / Edit → produce a code_diff or code component
      // Write/Edit → 生成 code_diff 或 code 组件
      if (block.name === 'Write' || block.name === 'write') {
        const filePath = (input['file_path'] as string) || (input['path'] as string) || '';
        const fileContent = (input['content'] as string) || '';
        if (filePath && fileContent) {
          components.push({
            kind: 'code',
            title: `Write ${filePath.split('/').pop()}`,
            content: fileContent,
            language: detectLanguage('', filePath),
            filePath,
            toolName: block.name,
            length: fileContent.length,
          });
          continue;
        }
      }

      if (block.name === 'Edit' || block.name === 'edit' || block.name === 'MultiEdit') {
        const filePath = (input['file_path'] as string) || (input['path'] as string) || '';
        const oldStr = (input['old_string'] as string) || (input['old_str'] as string) || '';
        const newStr = (input['new_string'] as string) || (input['new_str'] as string) || '';
        if (filePath && (oldStr || newStr)) {
          const oldLines = oldStr.split('\n').map((l: string) => `- ${l}`).join('\n');
          const newLines = newStr.split('\n').map((l: string) => `+ ${l}`).join('\n');
          const diff = `--- ${filePath}\n+++ ${filePath}\n\n${oldLines}\n${newLines}`;
          components.push({
            kind: 'code_diff',
            title: `Edit ${filePath.split('/').pop()}`,
            content: diff,
            filePath,
            toolName: block.name,
            length: diff.length,
          });
          continue;
        }
      }

      if (block.name === 'Bash' || block.name === 'bash') {
        const command = (input['command'] as string) || '';
        components.push({
          kind: 'tool_call',
          title: `$ ${command.split('\n')[0].slice(0, 60)}`,
          content: command,
          toolName: 'Bash',
          language: 'bash',
          length: command.length,
        });
        continue;
      }

      // Generic tool call summary / 通用工具调用摘要
      const summary = JSON.stringify(input, null, 2).slice(0, 500);
      components.push({
        kind: 'tool_call',
        title: block.name,
        content: summary,
        toolName: block.name,
        length: summary.length,
      });
    }
  }

  return components;
}

// ─── Node generation / 节点生成 ───────────────────────────────────────────────

/**
 * Generate a human-readable title from components and role.
 * 根据组件列表和角色生成人类可读的标题
 */
function generateNodeTitle(components: WikiComponent[], role: 'user' | 'assistant', turnIndex: number): string {
  const firstText = components.find((c) => c.kind === 'text');
  if (firstText) {
    const firstLine = firstText.content.split('\n')[0].replace(/^#+\s*/, '').trim();
    if (firstLine.length > 5) return firstLine.slice(0, 80);
  }

  const firstCode = components.find((c) => c.kind === 'code' || c.kind === 'code_diff');
  if (firstCode?.title) return firstCode.title;

  const firstTool = components.find((c) => c.kind === 'tool_call');
  if (firstTool?.title) return firstTool.title;

  return role === 'user' ? `User input (turn ${turnIndex + 1})` : `Response (turn ${turnIndex + 1})`;
}

/**
 * Generate a one-sentence summary from components.
 * 从组件列表生成单句摘要
 */
function generateNodeSummary(components: WikiComponent[]): string {
  const textComp = components.find((c) => c.kind === 'text');
  if (textComp) {
    return textComp.content
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 120)
      .trim();
  }

  const codeComps = components.filter((c) => c.kind === 'code' || c.kind === 'code_diff');
  if (codeComps.length > 0) {
    return codeComps.map((c) => c.title ?? c.kind).join(', ');
  }

  const toolComps = components.filter((c) => c.kind === 'tool_call');
  if (toolComps.length > 0) {
    return `Ran: ${toolComps.map((c) => c.toolName ?? 'tool').join(', ')}`;
  }

  return 'No summary available';
}

/**
 * Build DagNodes from a single ParsedMessage.
 * For large assistant messages, split at "section boundaries":
 *  - long text paragraphs
 *  - code / diff blocks
 *  - sequences of tool calls
 * 从单条 ParsedMessage 构建 DagNode 列表。
 * 对于大型助手消息，在"节边界"处拆分成独立节点。
 */
function buildNodesFromMessage(
  msg: ParsedMessage,
  turnIndex: number,
  projectId: string,
  sessionId: string,
  lineNumber: number,
): DagNode[] {
  if (msg.role === 'system') return [];
  const role = msg.role as 'user' | 'assistant';

  // Filter out pure tool_result user messages (they are not "turns")
  // 过滤纯 tool_result 用户消息（它们不是"轮次"）
  if (role === 'user') {
    const hasOnlyResults = msg.content.every((b: ContentBlock) => b.type === 'tool_result');
    if (hasOnlyResults) return [];
    const firstText = msg.content.find((b: ContentBlock) => b.type === 'text' && 'text' in b && b.text);
    if (!firstText) return [];
    const text = (firstText as ContentBlock & { text: string }).text.trim();
    const systemPrefixes = [
      '<bash-input>', '<bash-stdout>', '<task-notification>',
      '<system-reminder>', '<user-prompt-submit-hook>',
    ];
    if (systemPrefixes.some((p) => text.startsWith(p))) return [];
  }

  const allComponents = buildComponents(msg.content);
  if (allComponents.length === 0) return [];

  // For user messages: single node / 用户消息：单个节点
  if (role === 'user') {
    const nodeId = `turn${turnIndex}-user`;
    const uri = `wiki://${projectId}/${sessionId}/${nodeId}`;
    return [{
      uri,
      nodeId,
      title: generateNodeTitle(allComponents, role, turnIndex),
      summary: generateNodeSummary(allComponents),
      components: allComponents,
      rawText: allComponents.map((c) => c.content).join('\n'),
      turnUri: `wiki://${projectId}/${sessionId}/turn/${turnIndex}`,
      turnIndex,
      role,
      timestamp: msg.timestamp,
      source: { filePath: '', lineNumber, messageUuid: msg.uuid },
      dependsOn: [],
      enables: [],
      sessionUri: `wiki://${projectId}/${sessionId}`,
      caseUri: '',  // filled in later / 后续填充
      projectUri: `wiki://${projectId}`,
    }];
  }

  // For assistant messages: group into logical segments
  // 助手消息：按逻辑段分组成独立节点
  const nodes: DagNode[] = [];
  let segComponents: WikiComponent[] = [];
  let segIdx = 0;

  const flushSegment = () => {
    if (segComponents.length === 0) return;
    // Only create a node if there's meaningful content / 只有有实质内容才创建节点
    const hasSubstance = segComponents.some(
      (c) => c.kind !== 'text' || c.content.length >= MIN_NODE_TEXT_LEN
    );
    if (!hasSubstance && nodes.length > 0) {
      // Append to previous node's components / 追加到前一个节点的组件
      nodes[nodes.length - 1].components.push(...segComponents);
      nodes[nodes.length - 1].rawText += '\n' + segComponents.map((c) => c.content).join('\n');
    } else {
      const nodeId = `turn${turnIndex}-ast${segIdx}`;
      const uri = `wiki://${projectId}/${sessionId}/${nodeId}`;
      nodes.push({
        uri,
        nodeId,
        title: generateNodeTitle(segComponents, role, turnIndex),
        summary: generateNodeSummary(segComponents),
        components: segComponents,
        rawText: segComponents.map((c) => c.content).join('\n'),
        turnUri: `wiki://${projectId}/${sessionId}/turn/${turnIndex}`,
        turnIndex,
        role,
        timestamp: msg.timestamp,
        source: { filePath: '', lineNumber, messageUuid: msg.uuid },
        dependsOn: [],
        enables: [],
        sessionUri: `wiki://${projectId}/${sessionId}`,
        caseUri: '',
        projectUri: `wiki://${projectId}`,
      });
      segIdx++;
    }
    segComponents = [];
  };

  for (const comp of allComponents) {
    const isBreak = comp.kind === 'code' || comp.kind === 'code_diff' || comp.kind === 'tool_call';
    if (isBreak && segComponents.length > 0) {
      flushSegment();
      segComponents = [comp];
      flushSegment();
    } else {
      segComponents.push(comp);
    }
  }
  flushSegment();

  return nodes;
}

// ─── Edge inference / 边推断 ────────────────────────────────────────────────

/**
 * Collect all file paths written/edited by a node.
 * 收集节点写入/编辑的所有文件路径
 */
function collectWrittenFiles(node: DagNode): Set<string> {
  const files = new Set<string>();
  for (const comp of node.components) {
    if ((comp.kind === 'code' || comp.kind === 'code_diff') && comp.filePath) {
      files.add(comp.filePath);
    }
  }
  return files;
}

/**
 * Infer dependency edges between nodes based on file references.
 * Node B depends on node A if B reads a file that A wrote.
 * 基于文件引用推断节点间的依赖边。
 * 如果 B 引用了 A 写入的文件，则 B 依赖 A。
 */
function inferEdges(nodes: DagNode[]): void {
  // Build file → last writer map / 构建文件 → 最近写入者映射
  const fileWriters = new Map<string, string>(); // filePath → nodeUri

  for (const node of nodes) {
    const written = collectWrittenFiles(node);
    // Check if this node reads any file written by a previous node
    // 检查此节点是否读取了前一个节点写入的文件
    for (const comp of node.components) {
      if (comp.filePath && fileWriters.has(comp.filePath)) {
        const writerUri = fileWriters.get(comp.filePath)!;
        if (writerUri !== node.uri && !node.dependsOn.includes(writerUri)) {
          node.dependsOn.push(writerUri);
          const writer = nodes.find((n) => n.uri === writerUri);
          if (writer && !writer.enables.includes(node.uri)) {
            writer.enables.push(node.uri);
          }
        }
      }
    }
    // Register files written by this node / 登记此节点写入的文件
    for (const f of written) {
      fileWriters.set(f, node.uri);
    }
  }

  // Chain sequential nodes within the same turn
  // 同一轮次内的节点按顺序链接
  const byTurn = new Map<number, DagNode[]>();
  for (const node of nodes) {
    const existing = byTurn.get(node.turnIndex) ?? [];
    existing.push(node);
    byTurn.set(node.turnIndex, existing);
  }

  for (const turnNodes of byTurn.values()) {
    for (let i = 1; i < turnNodes.length; i++) {
      const prev = turnNodes[i - 1];
      const curr = turnNodes[i];
      if (!curr.dependsOn.includes(prev.uri)) {
        curr.dependsOn.push(prev.uri);
      }
      if (!prev.enables.includes(curr.uri)) {
        prev.enables.push(curr.uri);
      }
    }
  }
}

// ─── Case detection / 案例检测 ───────────────────────────────────────────────

/**
 * Detect whether a user message starts a new case.
 * Heuristics: time gap > CASE_GAP_MS, or explicit task keywords.
 * 检测用户消息是否开启新案例。
 * 启发式规则：时间间隔 > CASE_GAP_MS，或出现明确的任务关键词。
 */
function isNewCase(userText: string, prevTimestamp: string, currTimestamp: string): boolean {
  // Time gap heuristic / 时间间隔启发式
  if (prevTimestamp && currTimestamp) {
    const gap = new Date(currTimestamp).getTime() - new Date(prevTimestamp).getTime();
    if (gap > CASE_GAP_MS) return true;
  }

  // Keyword heuristic: strong task start indicators / 关键词：强任务开始指示符
  const lower = userText.toLowerCase();
  const taskKeywords = [
    'implement', 'add feature', 'fix bug', 'refactor', 'create',
    'build', 'write a', 'help me', 'i need', 'can you',
    '实现', '添加', '修复', '重构', '创建', '构建', '帮我', '我需要',
  ];
  return taskKeywords.some((kw) => lower.includes(kw));
}

// ─── Turn building / 轮次构建 ─────────────────────────────────────────────────

/**
 * Group messages into turns: each user message + following assistant messages.
 * 将消息分组为轮次：每条用户消息及其后续助手消息为一个轮次。
 */
function buildTurns(
  messages: ParsedMessage[],
  projectId: string,
  sessionId: string,
  nodes: DagNode[],
): WikiTurn[] {
  const turns: WikiTurn[] = [];
  let currentUserMsg: ParsedMessage | null = null;
  let currentAsstUuids: string[] = [];
  let currentAsstText = '';
  let turnIndex = 0;
  let lineCounter = 0;

  const nodesByTurnIndex = new Map<number, DagNode[]>();
  for (const node of nodes) {
    const existing = nodesByTurnIndex.get(node.turnIndex) ?? [];
    existing.push(node);
    nodesByTurnIndex.set(node.turnIndex, existing);
  }

  const flushTurn = () => {
    if (!currentUserMsg) return;

    const rawUserText = extractTextBlocks(currentUserMsg.content);
    const userText = cleanUserText(rawUserText);
    if (!userText) { currentUserMsg = null; return; }

    const uri = `wiki://${projectId}/${sessionId}/turn/${turnIndex}`;
    const turnNodes = nodesByTurnIndex.get(turnIndex) ?? [];
    const toolCalls: WikiTurn['toolCalls'] = [];

    for (const uuid of currentAsstUuids) {
      const msg = messages.find((m) => m.uuid === uuid);
      if (!msg) continue;
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          const input = block.input ?? {};
          let inputSummary = '';
          if (block.name === 'Bash') inputSummary = (input['command'] as string ?? '').split('\n')[0].slice(0, 80);
          else if (block.name === 'Write' || block.name === 'Edit') inputSummary = (input['file_path'] as string ?? '');
          else inputSummary = JSON.stringify(input).slice(0, 80);
          toolCalls.push({ toolName: block.name ?? 'unknown', inputSummary, isError: false });
        }
      }
    }

    turns.push({
      uri,
      index: turnIndex,
      userUuid: currentUserMsg.uuid,
      assistantUuids: currentAsstUuids,
      timestamp: currentUserMsg.timestamp,
      userText,
      assistantText: currentAsstText.trim().slice(0, 500),
      toolCalls,
      nodeUris: turnNodes.map((n) => n.uri),
      source: {
        filePath: '',
        lineNumber: lineCounter,
        messageUuid: currentUserMsg.uuid,
      },
    });

    turnIndex++;
    currentUserMsg = null;
    currentAsstUuids = [];
    currentAsstText = '';
  };

  for (const msg of messages) {
    lineCounter++;
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      const rawText = extractTextBlocks(msg.content);
      const cleaned = cleanUserText(rawText);
      // Skip pure tool-result injection messages / 跳过纯工具结果注入消息
      if (!cleaned || msg.content.every((b: ContentBlock) => b.type === 'tool_result')) continue;

      flushTurn();
      currentUserMsg = msg;
    } else if (msg.role === 'assistant') {
      currentAsstUuids.push(msg.uuid);
      const text = extractTextBlocks(msg.content);
      if (text) currentAsstText += (currentAsstText ? '\n' : '') + text;
    }
  }

  flushTurn();
  return turns;
}

// ─── Case grouping / 案例分组 ─────────────────────────────────────────────────

/**
 * Group turns into cases based on time gaps and task keywords.
 * 根据时间间隔和任务关键词将轮次分组为案例。
 */
function buildCases(
  turns: WikiTurn[],
  projectId: string,
  sessionId: string,
  nodes: DagNode[],
): WikiCase[] {
  if (turns.length === 0) return [];

  const cases: WikiCase[] = [];
  let caseIdx = 0;
  let caseStart = 0;
  let lastTimestamp = '';

  const flushCase = (endIdx: number) => {
    if (endIdx <= caseStart) return;
    const caseTurns = turns.slice(caseStart, endIdx);
    if (caseTurns.length === 0) return;

    const uri = `wiki://${projectId}/${sessionId}/case/${caseIdx}`;
    const turnUris = caseTurns.map((t) => t.uri);
    const nodeUris = caseTurns.flatMap((t) => t.nodeUris);

    // Title: first substantial user turn / 标题：第一条有实质内容的用户轮次
    const title = caseTurns[0].userText.split('\n')[0].slice(0, 80) || `Task ${caseIdx + 1}`;

    // Summary: first 160 chars of combined assistant text / 摘要：合并助手文本的前 160 字符
    const assistantSummary = caseTurns
      .map((t) => t.assistantText)
      .filter(Boolean)
      .join(' ')
      .slice(0, 160);

    const caseObj: WikiCase = {
      uri,
      index: caseIdx,
      title,
      summary: assistantSummary || title,
      turnUris,
      nodeUris,
      startTimestamp: caseTurns[0].timestamp,
      endTimestamp: caseTurns[caseTurns.length - 1].timestamp,
      sessionUri: `wiki://${projectId}/${sessionId}`,
    };

    // Back-fill caseUri on nodes / 回填节点的 caseUri
    for (const nodeUri of nodeUris) {
      const node = nodes.find((n) => n.uri === nodeUri);
      if (node) node.caseUri = uri;
    }

    cases.push(caseObj);
    caseIdx++;
    caseStart = endIdx;
  };

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (i === 0) {
      lastTimestamp = turn.timestamp;
      continue;
    }
    if (isNewCase(turn.userText, lastTimestamp, turn.timestamp)) {
      flushCase(i);
    }
    lastTimestamp = turn.timestamp;
  }
  flushCase(turns.length);

  return cases;
}

// ─── Main build function / 主构建函数 ─────────────────────────────────────────

/**
 * Build a complete WikiSession from a JSONL file.
 * 从 JSONL 文件构建完整的 WikiSession。
 */
export async function buildWikiSession(
  filePath: string,
  projectId: string,
): Promise<WikiSession> {
  const { meta, messages } = await parseSessionFile(filePath);

  // Step 1: Build all nodes from messages / 步骤1：从消息构建所有节点
  const allNodes: DagNode[] = [];
  let lineNumber = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    lineNumber++;

    // Assign turn index: count only "real" user messages before this
    // 计算轮次索引：统计此消息之前的真实用户消息数
    let turnIdx = 0;
    for (let j = 0; j < i; j++) {
      const m = messages[j];
      if (m.role === 'user') {
        const rawText = extractTextBlocks(m.content);
        const cleaned = cleanUserText(rawText);
        if (cleaned && !m.content.every((b: ContentBlock) => b.type === 'tool_result')) turnIdx++;
      }
    }

    const msgNodes = buildNodesFromMessage(msg, turnIdx, projectId, meta.id, lineNumber);
    allNodes.push(...msgNodes);
  }

  // Set source filePath on all nodes / 设置所有节点的源文件路径
  for (const node of allNodes) {
    node.source.filePath = filePath;
  }

  // Step 2: Infer edges / 步骤2：推断边
  inferEdges(allNodes);

  // Step 3: Build turns / 步骤3：构建轮次
  const turns = buildTurns(messages, projectId, meta.id, allNodes);

  // Step 4: Build cases / 步骤4：构建案例
  const cases = buildCases(turns, projectId, meta.id, allNodes);

  return {
    uri: `wiki://${projectId}/${meta.id}`,
    sessionId: meta.id,
    projectId,
    summary: meta.summary,
    gitBranch: meta.gitBranch,
    cwd: meta.cwd,
    firstTimestamp: meta.firstTimestamp,
    lastTimestamp: meta.lastTimestamp,
    messageCount: meta.messageCount,
    isAgent: meta.isAgent,
    filePath,
    cases,
    turns,
    nodes: allNodes,
    projectUri: `wiki://${projectId}`,
  };
}

/**
 * Build a WikiGraphResponse for the API (nodes + edges + turns + cases).
 * 为 API 构建 WikiGraphResponse（节点 + 边 + 轮次 + 案例）。
 */
export async function buildWikiGraph(
  filePath: string,
  projectId: string,
  sessionId: string,
): Promise<WikiGraphResponse> {
  const wikiSession = await buildWikiSession(filePath, projectId);

  // Build edge list / 构建边列表
  const edges: WikiGraphResponse['edges'] = [];

  // Sequential turn edges / 顺序轮次边
  const turns = wikiSession.turns;
  for (let i = 1; i < turns.length; i++) {
    edges.push({
      from: turns[i - 1].uri,
      to: turns[i].uri,
      kind: 'turn_sequence',
    });
  }

  // Dependency edges from nodes / 节点依赖边
  for (const node of wikiSession.nodes) {
    for (const dep of node.dependsOn) {
      edges.push({ from: dep, to: node.uri, kind: 'dependency' });
    }
  }

  // Case boundary edges / 案例边界边
  const cases = wikiSession.cases;
  for (let i = 1; i < cases.length; i++) {
    const prevLastTurn = cases[i - 1].turnUris[cases[i - 1].turnUris.length - 1];
    const nextFirstTurn = cases[i].turnUris[0];
    if (prevLastTurn && nextFirstTurn) {
      edges.push({ from: prevLastTurn, to: nextFirstTurn, kind: 'case_boundary' });
    }
  }

  return {
    projectId,
    sessionId,
    nodes: wikiSession.nodes,
    turns: wikiSession.turns,
    cases: wikiSession.cases,
    edges,
  };
}
