/**
 * Wiki data model types for DAG-based session knowledge graph
 * Session Wiki 知识图谱的数据模型类型定义
 *
 * Hierarchy: Project → Case → Session → Turn → DagNode
 * 层次结构:  项目    → 案例 → 会话   → 轮次 → DAG节点
 */

// --- Component types inside a DagNode / DAG节点内的组件类型 ---

export type ComponentKind =
  | 'text'        // Plain text paragraph / 纯文本段落
  | 'code'        // Code block with language / 代码块（带语言标识）
  | 'code_diff'   // Unified diff / 统一格式差异
  | 'table'       // Markdown table / Markdown 表格
  | 'url'         // Hyperlink / 超链接
  | 'file_path'   // File path reference / 文件路径引用
  | 'tool_call'   // Tool invocation summary / 工具调用摘要
  | 'tool_result' // Tool result summary / 工具执行结果摘要
  | 'image';      // Image (base64 or URL) / 图片（base64或URL）

export interface WikiComponent {
  kind: ComponentKind;
  /** Display title for this component / 组件显示标题 */
  title?: string;
  /** Primary content (text / code string / diff string / url) / 主要内容 */
  content: string;
  /** Language hint for code blocks / 代码块语言提示 */
  language?: string;
  /** Tool name for tool_call / tool_result / 工具名称 */
  toolName?: string;
  /** File path for code/diff/file_path components / 文件路径 */
  filePath?: string;
  /** Character count of raw content / 原始内容字符数 */
  length: number;
}

// --- Source location (back-link to raw JSONL) / 原始 JSONL 文件位置（反向链接） ---

export interface SourceLocation {
  /** Absolute path to the .jsonl file / JSONL 文件绝对路径 */
  filePath: string;
  /** Zero-indexed line number of the originating entry / 原始条目的行号（从0开始） */
  lineNumber: number;
  /** UUID of the originating message / 原始消息的 UUID */
  messageUuid: string;
}

// --- DAG Node — the atom of the wiki graph / DAG节点 — 知识图谱的原子单元 ---

export interface DagNode {
  /** Stable URI: wiki://{projectId}/{sessionId}/{nodeId} / 稳定的 URI 标识符 */
  uri: string;
  /** Short human-readable id within the session / 在会话内部的短人类可读 ID */
  nodeId: string;
  /** Node title (auto-generated or from first heading) / 节点标题（自动生成或来自第一个标题） */
  title: string;
  /** One-sentence summary / 单句摘要 */
  summary: string;
  /** Structured components / 结构化组件列表 */
  components: WikiComponent[];
  /** Raw plain-text content for search / 用于全文搜索的纯文本内容 */
  rawText: string;

  // Provenance / 来源信息
  /** Parent turn URI / 父级轮次 URI */
  turnUri: string;
  /** Source turn index in the session / 在会话中的原始轮次索引 */
  turnIndex: number;
  /** Role that produced this node / 生成此节点的角色 */
  role: 'user' | 'assistant';
  /** ISO timestamp / ISO 时间戳 */
  timestamp: string;
  /** Source location in raw JSONL file / 原始 JSONL 文件中的位置 */
  source: SourceLocation;

  // Graph edges / 图边
  /** Nodes this one depends on (incoming edges) / 依赖的前驱节点 URI 列表 */
  dependsOn: string[];
  /** Nodes that depend on this one (outgoing edges) / 依赖此节点的后继节点 URI 列表 */
  enables: string[];

  // Cross-level back-links / 跨层级反向链接
  sessionUri: string;
  caseUri: string;
  projectUri: string;
}

// --- Turn — a user+assistant exchange / 轮次 — 一次用户+助手的交换 ---

export interface WikiTurn {
  /** Stable URI: wiki://{projectId}/{sessionId}/turn/{index} / 稳定的 URI */
  uri: string;
  index: number;
  /** User message UUID / 用户消息 UUID */
  userUuid: string;
  /** Assistant message UUID(s) / 助手消息 UUID */
  assistantUuids: string[];
  timestamp: string;
  /** Plain-text user input (cleaned) / 清洗后的纯文本用户输入 */
  userText: string;
  /** Plain-text assistant response (cleaned) / 清洗后的纯文本助手回复 */
  assistantText: string;
  /** All tools invoked in this turn / 此轮次调用的所有工具 */
  toolCalls: Array<{ toolName: string; inputSummary: string; isError: boolean }>;
  /** DAG node URIs generated from this turn / 从此轮次生成的 DAG 节点 URI 列表 */
  nodeUris: string[];
  source: SourceLocation;
}

// --- Case — a coherent task within a session / 案例 — 会话中的一个连贯任务 ---

export interface WikiCase {
  /** Stable URI: wiki://{projectId}/{sessionId}/case/{index} / 稳定的 URI */
  uri: string;
  index: number;
  title: string;
  summary: string;
  /** Turn URIs belonging to this case (ordered) / 按顺序排列的轮次 URI 列表 */
  turnUris: string[];
  /** DAG node URIs in this case / 此案例中的 DAG 节点 URI 列表 */
  nodeUris: string[];
  startTimestamp: string;
  endTimestamp: string;
  sessionUri: string;
}

// --- Session wiki / 会话 Wiki ---

export interface WikiSession {
  /** Stable URI: wiki://{projectId}/{sessionId} / 稳定的 URI */
  uri: string;
  sessionId: string;
  projectId: string;
  summary?: string;
  gitBranch?: string;
  cwd?: string;
  firstTimestamp: string;
  lastTimestamp: string;
  messageCount: number;
  isAgent: boolean;
  filePath: string;
  cases: WikiCase[];
  turns: WikiTurn[];
  nodes: DagNode[];
  projectUri: string;
}

// --- Project wiki / 项目 Wiki ---

export interface WikiProject {
  /** Stable URI: wiki://{projectId} / 稳定的 URI */
  uri: string;
  projectId: string;
  displayName: string;
  decodedPath: string;
  sessionCount: number;
  lastActivity: string;
}

// --- API response shapes / API 响应结构 ---

export interface WikiSessionResponse {
  session: WikiSession;
}

export interface WikiGraphResponse {
  projectId: string;
  sessionId: string;
  nodes: DagNode[];
  turns: WikiTurn[];
  cases: WikiCase[];
  /** Adjacency list for rendering / 用于渲染的邻接表 */
  edges: Array<{ from: string; to: string; kind: 'turn_sequence' | 'dependency' | 'case_boundary' }>;
}
