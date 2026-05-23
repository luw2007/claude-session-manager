/**
 * WikiPanel — DAG-based session knowledge graph viewer
 * Wiki面板 — 基于 DAG 的会话知识图谱查看器
 *
 * Views: DAG (graph) → Case list → Turn timeline → Node card → Node detail
 * 视图层次: DAG图 → 案例列表 → 轮次时间线 → 节点卡片 → 节点详情
 */

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Clock, Code2, FileEdit, Link2,
  ChevronRight, ChevronDown, Terminal, FileText, Table2,
  GitCommit, Layers, Network, ListTree, AlignLeft,
  ExternalLink, Hash, ArrowRight, Loader2,
} from 'lucide-react';
import { wiki as wikiApi } from '../utils/api';
import type { WikiGraphResponse, DagNode, WikiTurn, WikiCase, WikiComponent } from '../utils/api';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  sessionId: string;
  onBack: () => void;
}

// ─── View state ───────────────────────────────────────────────────────────────

type PanelView = 'dag' | 'cases' | 'timeline' | 'node';

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtTime(ts: string): string {
  if (!ts) return '';
  try { return new Date(ts).toLocaleTimeString(); } catch { return ts; }
}

function fmtDate(ts: string): string {
  if (!ts) return '';
  try { return new Date(ts).toLocaleDateString(); } catch { return ts; }
}

function kindIcon(kind: WikiComponent['kind']) {
  switch (kind) {
    case 'code':        return <Code2 size={12} />;
    case 'code_diff':   return <GitCommit size={12} />;
    case 'table':       return <Table2 size={12} />;
    case 'url':         return <Link2 size={12} />;
    case 'tool_call':   return <Terminal size={12} />;
    case 'tool_result': return <FileText size={12} />;
    case 'file_path':   return <FileEdit size={12} />;
    default:            return <AlignLeft size={12} />;
  }
}

function kindColor(kind: WikiComponent['kind']): string {
  switch (kind) {
    case 'code':        return 'var(--status-info)';
    case 'code_diff':   return 'var(--status-warn)';
    case 'table':       return 'var(--accent)';
    case 'url':         return 'var(--status-ok)';
    case 'tool_call':   return 'var(--status-warn)';
    case 'tool_result': return 'var(--txt-3)';
    default:            return 'var(--txt-2)';
  }
}

// ─── Component detail card ────────────────────────────────────────────────────

const ComponentCard = memo(function ComponentCard({ comp }: { comp: WikiComponent }) {
  const [expanded, setExpanded] = useState(comp.kind !== 'text' || comp.content.length < 400);

  const isLong = comp.content.length > 600;
  const preview = isLong && !expanded ? comp.content.slice(0, 400) + '…' : comp.content;

  return (
    <div
      className="rounded-lg border mb-3 overflow-hidden"
      style={{ borderColor: 'var(--border-default)', background: 'var(--surface-0)' }}
    >
      {/* Component header / 组件头部 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
        style={{ background: 'var(--surface-1)' }}
      >
        <span style={{ color: kindColor(comp.kind) }}>{kindIcon(comp.kind)}</span>
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
          {comp.kind.replace('_', ' ')}
        </span>
        {comp.title && (
          <span className="text-[13px] font-medium truncate flex-1 ml-1" style={{ color: 'var(--txt-1)' }}>
            {comp.title}
          </span>
        )}
        {comp.filePath && (
          <span className="text-[11px] font-mono truncate" style={{ color: 'var(--txt-3)', maxWidth: 200 }}>
            {comp.filePath.split('/').slice(-2).join('/')}
          </span>
        )}
        {comp.language && comp.kind !== 'text' && (
          <span
            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold"
            style={{ background: 'var(--surface-2)', color: 'var(--txt-2)' }}
          >
            {comp.language}
          </span>
        )}
        <span className="text-[11px] font-mono ml-auto" style={{ color: 'var(--txt-3)' }}>
          {comp.length.toLocaleString()}c
        </span>
        <ChevronDown
          size={12}
          style={{
            color: 'var(--txt-3)',
            transform: expanded ? 'rotate(0)' : 'rotate(-90deg)',
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {/* Component body / 组件内容 */}
      {expanded && (
        <div className="px-4 py-3">
          {comp.kind === 'text' && (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--txt-1)' }}>
              {preview}
            </p>
          )}
          {(comp.kind === 'code' || comp.kind === 'code_diff' || comp.kind === 'tool_call') && (
            <pre
              className="text-[12px] overflow-x-auto rounded"
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                background: 'var(--surface-2)',
                padding: '10px 12px',
                color: comp.kind === 'code_diff' ? undefined : 'var(--txt-1)',
                lineHeight: 1.6,
              }}
            >
              {comp.kind === 'code_diff'
                ? preview.split('\n').map((line, i) => {
                    let c = 'var(--txt-2)';
                    if (line.startsWith('+ ')) c = 'var(--status-ok)';
                    else if (line.startsWith('- ')) c = 'var(--status-err)';
                    else if (line.startsWith('---') || line.startsWith('+++')) c = 'var(--txt-3)';
                    return (
                      <span key={i} style={{ color: c, display: 'block' }}>{line}</span>
                    );
                  })
                : preview}
            </pre>
          )}
          {comp.kind === 'url' && (
            <a
              href={comp.content}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[13px]"
              style={{ color: 'var(--status-ok)' }}
            >
              <ExternalLink size={13} />
              {comp.content}
            </a>
          )}
          {comp.kind === 'table' && (
            <pre className="text-[12px] overflow-x-auto" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--txt-1)' }}>
              {preview}
            </pre>
          )}
          {isLong && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-2 text-[11px] font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              Show all ({comp.length.toLocaleString()} chars)
            </button>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Node detail panel ────────────────────────────────────────────────────────

const NodeDetail = memo(function NodeDetail({
  node,
  allNodes,
  onNavigate,
}: {
  node: DagNode;
  allNodes: DagNode[];
  onNavigate: (uri: string) => void;
}) {
  const nodesByUri = useMemo(() => {
    const m = new Map<string, DagNode>();
    for (const n of allNodes) m.set(n.uri, n);
    return m;
  }, [allNodes]);

  const dependsOnNodes = node.dependsOn.map((u) => nodesByUri.get(u)).filter(Boolean) as DagNode[];
  const enablesNodes = node.enables.map((u) => nodesByUri.get(u)).filter(Boolean) as DagNode[];

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      {/* Node header / 节点头部 */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="px-2 py-0.5 rounded text-[11px] font-semibold"
            style={{
              background: node.role === 'user' ? 'rgba(59,130,246,0.12)' : 'var(--accent-muted)',
              color: node.role === 'user' ? 'var(--status-info)' : 'var(--accent)',
            }}
          >
            {node.role === 'user' ? 'You' : 'Claude'}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>{fmtTime(node.timestamp)}</span>
          <span className="text-[11px] font-mono ml-auto" style={{ color: 'var(--txt-3)' }}>
            turn {node.turnIndex + 1}
          </span>
        </div>
        <h2 className="text-[17px] font-bold leading-snug" style={{ color: 'var(--txt-1)', letterSpacing: '-0.018em' }}>
          {node.title}
        </h2>
        {node.summary !== node.title && (
          <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: 'var(--txt-2)' }}>
            {node.summary}
          </p>
        )}
      </div>

      {/* Dependency graph mini / 依赖关系迷你视图 */}
      {(dependsOnNodes.length > 0 || enablesNodes.length > 0) && (
        <div
          className="rounded-xl p-4 mb-6"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--txt-3)' }}>
            Dependencies
          </div>
          {dependsOnNodes.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] mb-1.5" style={{ color: 'var(--txt-3)' }}>← depends on</div>
              {dependsOnNodes.map((dep) => (
                <button
                  key={dep.uri}
                  onClick={() => onNavigate(dep.uri)}
                  className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg mb-1 transition-colors"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <ArrowLeft size={12} style={{ color: 'var(--txt-3)', flexShrink: 0 }} />
                  <span className="text-[12px] truncate" style={{ color: 'var(--txt-1)' }}>{dep.title}</span>
                </button>
              ))}
            </div>
          )}
          {enablesNodes.length > 0 && (
            <div>
              <div className="text-[11px] mb-1.5" style={{ color: 'var(--txt-3)' }}>→ enables</div>
              {enablesNodes.map((en) => (
                <button
                  key={en.uri}
                  onClick={() => onNavigate(en.uri)}
                  className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg mb-1 transition-colors"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <ArrowRight size={12} style={{ color: 'var(--txt-3)', flexShrink: 0 }} />
                  <span className="text-[12px] truncate" style={{ color: 'var(--txt-1)' }}>{en.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Components / 组件列表 */}
      <div className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--txt-3)' }}>
        Components ({node.components.length})
      </div>
      {node.components.map((comp, i) => (
        <ComponentCard key={i} comp={comp} />
      ))}

      {/* Source link / 源文件链接 */}
      <div
        className="mt-6 rounded-xl p-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)' }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--txt-3)' }}>
          Source
        </div>
        <div className="text-[11px] font-mono" style={{ color: 'var(--txt-2)', wordBreak: 'break-all' }}>
          {node.source.filePath}:{node.source.lineNumber}
        </div>
        <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--txt-3)' }}>
          {node.uri}
        </div>
      </div>
    </div>
  );
});

// ─── Node card (compact) / 节点卡片（精简）──────────────────────────────────────

const NodeCard = memo(function NodeCard({
  node,
  isSelected,
  onClick,
}: {
  node: DagNode;
  isSelected: boolean;
  onClick: () => void;
}) {
  const compCounts = useMemo(() => {
    const counts: Partial<Record<WikiComponent['kind'], number>> = {};
    for (const c of node.components) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    return counts;
  }, [node.components]);

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl p-4 mb-2 transition-all duration-150"
      style={{
        background: isSelected ? 'var(--accent-muted)' : 'var(--surface-0)',
        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-default)'}`,
        outline: 'none',
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-bold"
          style={{
            background: node.role === 'user' ? 'rgba(59,130,246,0.12)' : 'rgba(99,102,241,0.12)',
            color: node.role === 'user' ? 'var(--status-info)' : 'var(--accent)',
          }}
        >
          {node.role === 'user' ? 'U' : 'A'}
        </span>
        <span className="text-[11px] font-mono" style={{ color: 'var(--txt-3)' }}>
          T{node.turnIndex + 1}
        </span>
        <span className="text-[11px] ml-auto" style={{ color: 'var(--txt-3)' }}>
          {fmtTime(node.timestamp)}
        </span>
      </div>

      <div
        className="text-[13px] font-semibold leading-snug mb-1.5 line-clamp-2"
        style={{ color: 'var(--txt-1)' }}
      >
        {node.title}
      </div>

      {/* Component badges / 组件徽标 */}
      <div className="flex flex-wrap gap-1 mt-2">
        {(Object.entries(compCounts) as [WikiComponent['kind'], number][]).map(([kind, count]) => (
          <span
            key={kind}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
            style={{ background: 'var(--surface-2)', color: 'var(--txt-2)' }}
          >
            <span style={{ color: kindColor(kind) }}>{kindIcon(kind)}</span>
            {count > 1 ? `${count}×` : ''}{kind.replace('_', ' ')}
          </span>
        ))}
      </div>

      {/* Dependency indicators / 依赖指示符 */}
      {(node.dependsOn.length > 0 || node.enables.length > 0) && (
        <div className="flex items-center gap-2 mt-2">
          {node.dependsOn.length > 0 && (
            <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
              ← {node.dependsOn.length}
            </span>
          )}
          {node.enables.length > 0 && (
            <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
              → {node.enables.length}
            </span>
          )}
        </div>
      )}
    </button>
  );
});

// ─── Case card / 案例卡片 ─────────────────────────────────────────────────────

const CaseCard = memo(function CaseCard({
  wikiCase,
  turns,
  isSelected,
  onClick,
}: {
  wikiCase: WikiCase;
  turns: WikiTurn[];
  isSelected: boolean;
  onClick: () => void;
}) {
  const caseTurns = turns.filter((t) => wikiCase.turnUris.includes(t.uri));
  const toolCount = caseTurns.reduce((s, t) => s + t.toolCalls.length, 0);

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl p-4 mb-3 transition-all duration-150"
      style={{
        background: isSelected ? 'var(--accent-muted)' : 'var(--surface-0)',
        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-default)'}`,
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Hash size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
          Case {wikiCase.index + 1}
        </span>
        <span className="text-[11px] ml-auto" style={{ color: 'var(--txt-3)' }}>
          {fmtDate(wikiCase.startTimestamp)}
        </span>
      </div>

      <div className="text-[14px] font-semibold leading-snug mb-1.5" style={{ color: 'var(--txt-1)' }}>
        {wikiCase.title}
      </div>

      {wikiCase.summary && wikiCase.summary !== wikiCase.title && (
        <p className="text-[12px] leading-relaxed mb-2 line-clamp-2" style={{ color: 'var(--txt-2)' }}>
          {wikiCase.summary}
        </p>
      )}

      <div className="flex items-center gap-3 mt-2">
        <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
          {wikiCase.turnUris.length} turns
        </span>
        <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
          {wikiCase.nodeUris.length} nodes
        </span>
        {toolCount > 0 && (
          <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            {toolCount} tool calls
          </span>
        )}
      </div>
    </button>
  );
});

// ─── Turn row in timeline / 时间线中的轮次行 ─────────────────────────────────

const TurnRow = memo(function TurnRow({
  turn,
  nodes,
  isSelected,
  onClick,
}: {
  turn: WikiTurn;
  nodes: DagNode[];
  isSelected: boolean;
  onClick: () => void;
}) {
  const turnNodes = nodes.filter((n) => turn.nodeUris.includes(n.uri));
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="mb-3 rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-default)'}`,
        background: isSelected ? 'var(--accent-muted)' : 'var(--surface-0)',
      }}
    >
      {/* Turn header / 轮次头部 */}
      <button
        onClick={onClick}
        className="w-full text-left px-4 py-3"
      >
        <div className="flex items-center gap-2 mb-1">
          <GitCommit size={12} style={{ color: 'var(--txt-3)', flexShrink: 0 }} />
          <span className="text-[11px] font-mono font-bold" style={{ color: 'var(--txt-3)' }}>
            Turn {turn.index + 1}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            {fmtTime(turn.timestamp)}
          </span>
          {turn.toolCalls.length > 0 && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold ml-auto"
              style={{ background: 'var(--surface-2)', color: 'var(--txt-2)' }}
            >
              <Terminal size={9} className="inline mr-0.5" />
              {turn.toolCalls.length}
            </span>
          )}
        </div>
        <p className="text-[13px] leading-snug line-clamp-2 text-left" style={{ color: 'var(--txt-1)' }}>
          {turn.userText}
        </p>
      </button>

      {/* Expandable node list / 可展开的节点列表 */}
      {turnNodes.length > 0 && (
        <div className="px-4 pb-3 pt-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold"
            style={{ color: 'var(--txt-3)' }}
          >
            <ChevronRight
              size={12}
              style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}
            />
            {turnNodes.length} nodes
          </button>
          {expanded && (
            <div className="mt-2 space-y-1">
              {turnNodes.map((node) => (
                <div
                  key={node.uri}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: 'var(--surface-1)' }}
                >
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{
                      background: node.role === 'user' ? 'rgba(59,130,246,0.12)' : 'rgba(99,102,241,0.12)',
                      color: node.role === 'user' ? 'var(--status-info)' : 'var(--accent)',
                    }}
                  >
                    {node.role === 'user' ? 'U' : 'A'}
                  </span>
                  <span className="text-[12px] truncate flex-1" style={{ color: 'var(--txt-1)' }}>
                    {node.title}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                    {node.components.length}c
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ─── DAG graph view (force-layout approximation via column layout) ─────────────

function DagView({
  graph,
  onSelectNode,
  selectedNodeUri,
}: {
  graph: WikiGraphResponse;
  onSelectNode: (node: DagNode) => void;
  selectedNodeUri: string | null;
}) {
  // Group nodes by turnIndex for column layout
  // 按 turnIndex 列分组节点，实现列式布局
  const columns = useMemo(() => {
    const cols = new Map<number, DagNode[]>();
    for (const node of graph.nodes) {
      const existing = cols.get(node.turnIndex) ?? [];
      existing.push(node);
      cols.set(node.turnIndex, existing);
    }
    return Array.from(cols.entries()).sort((a, b) => a[0] - b[0]);
  }, [graph.nodes]);

  const caseColors = useMemo(() => {
    const palette = [
      'rgba(99,102,241,0.08)', 'rgba(59,130,246,0.08)',
      'rgba(16,185,129,0.08)', 'rgba(245,158,11,0.08)',
      'rgba(239,68,68,0.08)',  'rgba(168,85,247,0.08)',
    ];
    const map = new Map<string, string>();
    graph.cases.forEach((c, i) => map.set(c.uri, palette[i % palette.length]));
    return map;
  }, [graph.cases]);

  return (
    <div className="h-full overflow-x-auto overflow-y-auto p-4">
      <div className="flex gap-3 items-start min-h-full">
        {columns.map(([turnIdx, nodes]) => {
          // Find which case this turn belongs to / 找到此轮次所属案例
          const caseBg = (() => {
            const turn = graph.turns.find((t) => t.index === turnIdx);
            if (!turn) return 'transparent';
            const wc = graph.cases.find((c) => c.turnUris.includes(turn.uri));
            return wc ? (caseColors.get(wc.uri) ?? 'transparent') : 'transparent';
          })();

          return (
            <div
              key={turnIdx}
              className="flex-shrink-0 rounded-xl p-2"
              style={{ minWidth: 200, background: caseBg }}
            >
              {/* Turn label / 轮次标签 */}
              <div
                className="text-[10px] font-mono font-bold text-center py-1 mb-2 rounded"
                style={{ color: 'var(--txt-3)', background: 'var(--surface-1)' }}
              >
                T{turnIdx + 1}
              </div>

              {/* Node stack / 节点堆叠 */}
              {nodes.map((node) => (
                <button
                  key={node.uri}
                  onClick={() => onSelectNode(node)}
                  className="w-full text-left rounded-lg p-3 mb-1.5 transition-all duration-100"
                  style={{
                    background: selectedNodeUri === node.uri ? 'var(--accent)' : 'var(--surface-0)',
                    border: `1px solid ${selectedNodeUri === node.uri ? 'var(--accent)' : 'var(--border-default)'}`,
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="text-[9px] font-bold px-1 py-0.5 rounded"
                      style={{
                        background: node.role === 'user' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.15)',
                        color: selectedNodeUri === node.uri ? '#fff' : (node.role === 'user' ? 'var(--status-info)' : 'var(--accent)'),
                      }}
                    >
                      {node.role === 'user' ? 'U' : 'A'}
                    </span>
                    {node.components.map((c, i) => (
                      <span key={i} style={{ color: selectedNodeUri === node.uri ? 'rgba(255,255,255,0.7)' : kindColor(c.kind) }}>
                        {kindIcon(c.kind)}
                      </span>
                    )).slice(0, 4)}
                    {node.components.length > 4 && (
                      <span className="text-[9px]" style={{ color: selectedNodeUri === node.uri ? 'rgba(255,255,255,0.5)' : 'var(--txt-3)' }}>
                        +{node.components.length - 4}
                      </span>
                    )}
                  </div>
                  <div
                    className="text-[11px] font-medium line-clamp-2 leading-tight"
                    style={{ color: selectedNodeUri === node.uri ? '#fff' : 'var(--txt-1)' }}
                  >
                    {node.title}
                  </div>
                  {/* Dependency arrows / 依赖箭头 */}
                  {(node.dependsOn.length > 0 || node.enables.length > 0) && (
                    <div className="flex gap-2 mt-1.5">
                      {node.dependsOn.length > 0 && (
                        <span className="text-[9px]" style={{ color: selectedNodeUri === node.uri ? 'rgba(255,255,255,0.6)' : 'var(--txt-3)' }}>
                          ←{node.dependsOn.length}
                        </span>
                      )}
                      {node.enables.length > 0 && (
                        <span className="text-[9px]" style={{ color: selectedNodeUri === node.uri ? 'rgba(255,255,255,0.6)' : 'var(--txt-3)' }}>
                          →{node.enables.length}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Legend / 图例 */}
      <div
        className="fixed bottom-4 right-4 flex items-center gap-3 px-3 py-2 rounded-lg text-[11px]"
        style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}
      >
        <span style={{ color: 'var(--txt-3)' }}>←N depends on N</span>
        <span style={{ color: 'var(--txt-3)' }}>→N enables N</span>
        {graph.cases.map((c, i) => (
          <span key={c.uri} className="flex items-center gap-1">
            <span
              className="w-3 h-3 rounded"
              style={{ background: Array.from(caseColors.values())[i] ?? 'transparent', border: '1px solid var(--border-default)' }}
            />
            <span style={{ color: 'var(--txt-2)' }}>{c.title.slice(0, 20)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main WikiPanel ───────────────────────────────────────────────────────────

export default function WikiPanel({ projectId, sessionId, onBack }: Props) {
  const { t } = useTranslation();
  const [graph, setGraph] = useState<WikiGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<PanelView>('dag');
  const [selectedCase, setSelectedCase] = useState<WikiCase | null>(null);
  const [selectedNode, setSelectedNode] = useState<DagNode | null>(null);

  // Load graph / 加载图谱
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    wikiApi.graph(projectId, sessionId, ctrl.signal)
      .then((data) => {
        setGraph(data);
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [projectId, sessionId]);

  const handleSelectNode = useCallback((node: DagNode) => {
    setSelectedNode(node);
    setView('node');
  }, []);

  const visibleTurns = useMemo(() => {
    if (!graph) return [];
    if (!selectedCase) return graph.turns;
    return graph.turns.filter((t) => selectedCase.turnUris.includes(t.uri));
  }, [graph, selectedCase]);

  const visibleNodes = useMemo(() => {
    if (!graph) return [];
    if (!selectedCase) return graph.nodes;
    return graph.nodes.filter((n) => selectedCase.nodeUris.includes(n.uri));
  }, [graph, selectedCase]);

  // View tabs config / 视图标签配置
  const tabs = graph ? [
    { id: 'dag' as PanelView,      icon: <Network size={14} />,   label: t('wiki.view_dag'),      count: graph.nodes.length },
    { id: 'cases' as PanelView,    icon: <Layers size={14} />,    label: t('wiki.view_cases'),    count: graph.cases.length },
    { id: 'timeline' as PanelView, icon: <ListTree size={14} />,  label: t('wiki.view_timeline'), count: graph.turns.length },
  ] : [];

  return (
    <div className="flex flex-col h-full">
      {/* Header / 头部 */}
      <div
        className="flex items-center gap-3 px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-default)', background: 'var(--surface-0)' }}
      >
        <button onClick={onBack} className="btn btn-ghost !p-2">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Network size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span className="text-[15px] font-bold truncate" style={{ color: 'var(--txt-1)', letterSpacing: '-0.018em' }}>
              {t('wiki.title')}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[11px] font-mono truncate" style={{ color: 'var(--txt-3)' }}>
              {sessionId.slice(0, 16)}…
            </span>
            {graph?.cases?.[0]?.startTimestamp && (
              <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--txt-3)' }}>
                <Clock size={10} />
                {fmtDate(graph.cases[0].startTimestamp)}
              </span>
            )}
          </div>
        </div>

        {/* Case filter / 案例筛选 */}
        {graph && graph.cases.length > 1 && (
          <select
            value={selectedCase?.uri ?? ''}
            onChange={(e) => {
              const c = graph.cases.find((c) => c.uri === e.target.value) ?? null;
              setSelectedCase(c);
            }}
            className="text-[12px] rounded-lg px-2 py-1.5 border"
            style={{
              background: 'var(--surface-1)',
              color: 'var(--txt-1)',
              borderColor: 'var(--border-default)',
              maxWidth: 180,
            }}
          >
            <option value="">All cases</option>
            {graph.cases.map((c) => (
              <option key={c.uri} value={c.uri}>Case {c.index + 1}: {c.title.slice(0, 30)}</option>
            ))}
          </select>
        )}
      </div>

      {/* Tab bar / 标签栏 */}
      {!loading && !error && (
        <div
          className="flex items-center gap-1 px-6 py-2 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border-default)', background: 'var(--surface-0)' }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={`view-tab ${view === tab.id ? 'active' : ''}`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span
                className="px-1.5 rounded"
                style={{
                  background: view === tab.id ? 'var(--accent)' : 'var(--surface-2)',
                  color: view === tab.id ? '#fff' : 'var(--txt-3)',
                  fontSize: '0.65rem',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 700,
                }}
              >
                {tab.count}
              </span>
            </button>
          ))}
          {view === 'node' && selectedNode && (
            <>
              <span style={{ color: 'var(--txt-3)', margin: '0 4px' }}>
                <ChevronRight size={12} />
              </span>
              <span
                className="text-[12px] font-medium truncate"
                style={{ color: 'var(--txt-2)', maxWidth: 200 }}
              >
                {selectedNode.title}
              </span>
            </>
          )}
        </div>
      )}

      {/* Content area / 内容区 */}
      <div className="flex-1 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center h-full gap-2" style={{ color: 'var(--txt-3)' }}>
            <Loader2 size={20} className="animate-spin" />
            <span className="text-[13px]">{t('wiki.building')}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-[14px]" style={{ color: 'var(--status-err)' }}>{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="btn btn-ghost mt-3 text-[12px]"
              >
                {t('common.retry')}
              </button>
            </div>
          </div>
        )}

        {!loading && !error && graph && (
          <>
            {/* DAG view / DAG 视图 */}
            {view === 'dag' && (
              <DagView
                graph={{ ...graph, nodes: visibleNodes, turns: visibleTurns }}
                onSelectNode={handleSelectNode}
                selectedNodeUri={selectedNode?.uri ?? null}
              />
            )}

            {/* Cases view / 案例视图 */}
            {view === 'cases' && (
              <div className="h-full overflow-y-auto px-4 py-4">
                {graph.cases.length === 0 && (
                  <div className="empty-state h-full">
                    <div className="empty-state-icon"><Layers size={28} /></div>
                    <p className="text-sm">{t('wiki.no_cases')}</p>
                  </div>
                )}
                {graph.cases.map((wikiCase) => (
                  <CaseCard
                    key={wikiCase.uri}
                    wikiCase={wikiCase}
                    turns={graph.turns}
                    isSelected={selectedCase?.uri === wikiCase.uri}
                    onClick={() => {
                      setSelectedCase(selectedCase?.uri === wikiCase.uri ? null : wikiCase);
                    }}
                  />
                ))}
              </div>
            )}

            {/* Timeline view / 时间线视图 */}
            {view === 'timeline' && (
              <div className="h-full overflow-y-auto px-4 py-4">
                {visibleTurns.length === 0 && (
                  <div className="empty-state h-full">
                    <div className="empty-state-icon"><ListTree size={28} /></div>
                    <p className="text-sm">{t('wiki.no_turns')}</p>
                  </div>
                )}
                {visibleTurns.map((turn) => (
                  <TurnRow
                    key={turn.uri}
                    turn={turn}
                    nodes={graph.nodes}
                    isSelected={selectedNode?.turnUri === turn.uri}
                    onClick={() => {
                      // Jump to first node of this turn / 跳转到此轮次的第一个节点
                      const firstNodeUri = turn.nodeUris[0];
                      if (firstNodeUri) {
                        const node = graph.nodes.find((n) => n.uri === firstNodeUri);
                        if (node) handleSelectNode(node);
                      }
                    }}
                  />
                ))}
              </div>
            )}

            {/* Node detail view / 节点详情视图 */}
            {view === 'node' && selectedNode && (
              <div className="h-full flex">
                {/* Left: node list / 左侧：节点列表 */}
                <div
                  className="w-72 flex-shrink-0 h-full overflow-y-auto border-r p-3"
                  style={{ borderColor: 'var(--border-default)', background: 'var(--surface-1)' }}
                >
                  {visibleNodes.map((node) => (
                    <NodeCard
                      key={node.uri}
                      node={node}
                      isSelected={selectedNode.uri === node.uri}
                      onClick={() => setSelectedNode(node)}
                    />
                  ))}
                </div>

                {/* Right: node detail / 右侧：节点详情 */}
                <div className="flex-1 h-full overflow-hidden">
                  <NodeDetail
                    node={selectedNode}
                    allNodes={graph.nodes}
                    onNavigate={(uri) => {
                      const node = graph.nodes.find((n) => n.uri === uri);
                      if (node) setSelectedNode(node);
                    }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
