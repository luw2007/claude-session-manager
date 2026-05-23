/**
 * Recent sessions panel / 最近会话面板
 * Cross-project view with list and board (kanban) modes
 * 跨项目查看，支持列表和看板两种视图
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock, MessageSquare, GitBranch, Bot, RefreshCw,
  FolderOpen, FolderClosed, List, LayoutGrid, Columns, Layers, ChevronDown, ChevronRight,
  Pin, PinOff, CheckSquare, Square, MinusSquare,
} from 'lucide-react';
import { recent as recentApi, pins as pinsApi, type RecentSession, type SessionStatus } from '../utils/api';

interface Props {
  onNavigate: (projectId: string, sessionId: string) => void;
}

const RANGES: { hours: number; labelKey: string }[] = [
  { hours: 0.5, labelKey: 'recent.range_30m' },
  { hours: 1, labelKey: 'recent.range_1h' },
  { hours: 3, labelKey: 'recent.range_3h' },
  { hours: 6, labelKey: 'recent.range_6h' },
  { hours: 12, labelKey: 'recent.range_12h' },
  { hours: 24, labelKey: 'recent.range_1d' },
  { hours: 168, labelKey: 'recent.range_7d' },
  { hours: 720, labelKey: 'recent.range_30d' },
];

type ViewMode = 'list' | 'board' | 'kanban';

const STATUS_ORDER: Record<SessionStatus, number> = { active: 0, idle: 1, ended: 2 };

const STATUS_STYLES: Record<SessionStatus, { dot: string; bg: string; text: string }> = {
  active: { dot: 'var(--status-ok)', bg: 'rgba(15, 138, 95, 0.1)', text: 'var(--status-ok)' },
  idle: { dot: 'var(--status-warn)', bg: 'rgba(217, 119, 6, 0.1)', text: 'var(--status-warn)' },
  ended: { dot: 'var(--txt-3)', bg: 'var(--surface-2)', text: 'var(--txt-3)' },
};

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatTokens(tokens: RecentSession['totalTokens']): string {
  const total = (tokens.input_tokens || 0) + (tokens.output_tokens || 0);
  if (total > 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total > 1_000) return `${(total / 1_000).toFixed(0)}K`;
  return String(total);
}

function StatusBadge({ status }: { status: SessionStatus }) {
  const { t } = useTranslation();
  const style = STATUS_STYLES[status];
  const labelKey = `recent.status_${status}` as const;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: style.bg, color: style.text }}
    >
      <span
        className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${status === 'active' ? 'animate-pulse' : ''}`}
        style={{ background: style.dot }}
      />
      {t(labelKey)}
    </span>
  );
}

function BoardCard({ session, onNavigate, pinned, onTogglePin }: { session: RecentSession; onNavigate: Props['onNavigate']; pinned: boolean; onTogglePin: (projectId: string, sessionId: string) => void }) {
  return (
    <div
      onClick={() => onNavigate(session.projectPath, session.id)}
      className="group card p-5 cursor-pointer hover:translate-y-[-2px] animate-fade-in flex flex-col relative"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onTogglePin(session.projectPath, session.id); }}
        className="absolute top-3 right-3 p-1.5 rounded-lg transition-all hover:scale-110"
        style={{
          background: pinned ? 'var(--accent-muted)' : 'var(--surface-2)',
          color: pinned ? 'var(--accent)' : 'var(--txt-3)',
          opacity: pinned ? 1 : 0,
        }}
        title={pinned ? 'Unpin' : 'Pin'}
        data-pin-btn
      >
        {pinned ? <PinOff size={13} /> : <Pin size={13} />}
      </button>
      <div className="flex items-center justify-between gap-2 mb-3 pr-7">
        <StatusBadge status={session.status} />
        <span
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md truncate max-w-[140px]"
          style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}
          title={session.projectName}
        >
          <FolderOpen size={10} className="flex-shrink-0" />
          <span className="truncate">{session.projectName}</span>
        </span>
      </div>
      <p
        className="text-[14px] font-semibold leading-snug mb-3 line-clamp-2 group-hover:text-[color:var(--accent)] transition-colors"
        style={{ color: 'var(--txt-1)', letterSpacing: '-0.012em' }}
      >
        {session.summary || session.id}
      </p>
      <div className="flex items-center gap-3 mt-auto flex-wrap">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
          <Clock size={11} />
          {formatTime(session.lastTimestamp)}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--txt-3)' }}>
          <MessageSquare size={11} />
          {session.messageCount}
        </span>
        {session.gitBranch && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium truncate max-w-[100px]" style={{ color: 'var(--txt-3)' }} title={session.gitBranch}>
            <GitBranch size={11} className="flex-shrink-0" />
            <span className="truncate">{session.gitBranch}</span>
          </span>
        )}
        {session.isAgent && (
          <span className="badge badge-tool !text-[10px] !px-1.5 !py-0">
            <Bot size={10} className="mr-0.5" />
            Agent
          </span>
        )}
        <span
          className="text-[11px] font-bold px-1.5 py-0.5 rounded ml-auto"
          style={{ background: 'var(--surface-2)', color: 'var(--txt-2)', fontFamily: 'JetBrains Mono, monospace' }}
        >
          {formatTokens(session.totalTokens)}
        </span>
      </div>
    </div>
  );
}

function ListRow({ session, onNavigate, maxTokens, pinned, onTogglePin }: { session: RecentSession; onNavigate: Props['onNavigate']; maxTokens: number; pinned: boolean; onTogglePin: (projectId: string, sessionId: string) => void }) {
  const { t } = useTranslation();
  const totalTokens = (session.totalTokens.input_tokens || 0) + (session.totalTokens.output_tokens || 0);
  const tokenPct = Math.round((totalTokens / maxTokens) * 100);

  return (
    <div
      onClick={() => onNavigate(session.projectPath, session.id)}
      className="group card p-6 cursor-pointer hover:translate-y-[-2px] animate-fade-in relative"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onTogglePin(session.projectPath, session.id); }}
        className="absolute top-4 right-4 p-1.5 rounded-lg transition-all hover:scale-110"
        style={{
          background: pinned ? 'var(--accent-muted)' : 'var(--surface-2)',
          color: pinned ? 'var(--accent)' : 'var(--txt-3)',
          opacity: pinned ? 1 : 0,
        }}
        title={pinned ? 'Unpin' : 'Pin'}
        data-pin-btn
      >
        {pinned ? <PinOff size={14} /> : <Pin size={14} />}
      </button>
      <div className="flex items-start justify-between gap-4 pr-8">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <StatusBadge status={session.status} />
            <span
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md"
              style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}
            >
              <FolderOpen size={11} />
              {session.projectName}
            </span>
            {session.isAgent && (
              <span className="badge badge-tool">
                <Bot size={11} className="mr-1" />
                {t('sessions.agent_session')}
              </span>
            )}
          </div>
          <p
            className="text-[16px] font-semibold truncate leading-snug group-hover:text-[color:var(--accent)] transition-colors"
            style={{ color: 'var(--txt-1)', letterSpacing: '-0.012em' }}
          >
            {session.summary || session.id}
          </p>
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--txt-3)' }}>
              <Clock size={13} />
              {formatTime(session.lastTimestamp)}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--txt-3)' }}>
              <MessageSquare size={13} />
              {session.messageCount} {t('sessions.messages')}
            </span>
            {session.gitBranch && (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--txt-3)' }}>
                <GitBranch size={13} />
                {session.gitBranch}
              </span>
            )}
            <span
              className="text-[12px] font-bold px-2 py-0.5 rounded-md ml-auto"
              style={{ background: 'var(--surface-2)', color: 'var(--txt-2)', fontFamily: 'JetBrains Mono, monospace' }}
            >
              {formatTokens(session.totalTokens)} tok
            </span>
          </div>
          <div className="mt-4">
            <div className="token-bar !h-1.5">
              <div className="token-bar-fill" style={{ width: `${tokenPct}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KanbanCard({ session, onNavigate, onDragStart }: { session: RecentSession; onNavigate: Props['onNavigate']; onDragStart: (session: RecentSession) => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        onDragStart(session);
        e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).style.opacity = '0.4';
      }}
      onDragEnd={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
      onClick={() => onNavigate(session.projectPath, session.id)}
      className="group card p-4 cursor-grab active:cursor-grabbing hover:translate-y-[-1px] animate-fade-in flex flex-col"
    >
      <p
        className="text-[13px] font-semibold leading-snug mb-2 line-clamp-2 group-hover:text-[color:var(--accent)] transition-colors"
        style={{ color: 'var(--txt-1)', letterSpacing: '-0.01em' }}
      >
        {session.summary || session.id}
      </p>
      <div className="flex items-center gap-2 mt-auto flex-wrap">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md truncate max-w-[100px]"
          style={{ background: 'var(--surface-2)', color: 'var(--accent)' }}
          title={session.projectName}
        >
          <FolderOpen size={9} className="flex-shrink-0" />
          <span className="truncate">{session.projectName}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: 'var(--txt-3)' }}>
          <Clock size={10} />
          {formatTime(session.lastTimestamp)}
        </span>
        {session.isAgent && (
          <span className="badge badge-tool !text-[9px] !px-1 !py-0">
            <Bot size={9} />
          </span>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({ status, sessions, onNavigate, onDrop, onDragStart, dragOver, onDragEnter, onDragLeave }: {
  status: SessionStatus;
  sessions: RecentSession[];
  onNavigate: Props['onNavigate'];
  onDrop: (status: SessionStatus) => void;
  onDragStart: (session: RecentSession) => void;
  dragOver: boolean;
  onDragEnter: (status: SessionStatus) => void;
  onDragLeave: () => void;
}) {
  const { t } = useTranslation();
  const style = STATUS_STYLES[status];
  const enterCount = useRef(0);

  return (
    <div
      className="flex-1 min-w-[280px] flex flex-col rounded-xl transition-all h-[calc(100vh-320px)]"
      style={{
        background: dragOver ? style.bg : 'var(--surface-1)',
        border: `1.5px ${dragOver ? 'dashed' : 'solid'} ${dragOver ? style.dot : 'var(--border-default)'}`,
      }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDragEnter={(e) => { e.preventDefault(); enterCount.current++; onDragEnter(status); }}
      onDragLeave={() => { enterCount.current--; if (enterCount.current <= 0) { enterCount.current = 0; onDragLeave(); } }}
      onDrop={(e) => { e.preventDefault(); enterCount.current = 0; onDrop(status); }}
    >
      <div className="flex items-center gap-2 p-4 pb-2 sticky top-0 z-10 rounded-t-xl" style={{ background: 'inherit' }}>
        <span
          className={`w-[8px] h-[8px] rounded-full flex-shrink-0 ${status === 'active' ? 'animate-pulse' : ''}`}
          style={{ background: style.dot }}
        />
        <span className="text-[13px] font-bold" style={{ color: style.text }}>
          {t(`recent.status_${status}`)}
        </span>
        <span
          className="text-[11px] font-bold px-1.5 py-0.5 rounded-full ml-auto"
          style={{ background: style.bg, color: style.text }}
        >
          {sessions.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 pt-1 space-y-2.5">
        {sessions.map((session) => (
          <KanbanCard key={`${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} onDragStart={onDragStart} />
        ))}
        {sessions.length === 0 && (
          <div className="text-center py-8 text-[12px]" style={{ color: 'var(--txt-3)' }}>
            {t('recent.kanban_empty')}
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanCell({ status, sessions, onNavigate, onDragStart, onDrop, dragOver, onDragEnter, onDragLeave }: {
  status: SessionStatus;
  sessions: RecentSession[];
  onNavigate: Props['onNavigate'];
  onDragStart: (session: RecentSession) => void;
  onDrop: (status: SessionStatus) => void;
  dragOver: boolean;
  onDragEnter: (status: SessionStatus) => void;
  onDragLeave: () => void;
}) {
  const { t } = useTranslation();
  const style = STATUS_STYLES[status];
  const enterCount = useRef(0);
  return (
    <div
      className="flex-1 min-w-[200px] rounded-lg p-2 space-y-2 transition-all min-h-[60px]"
      style={{
        background: dragOver ? style.bg : 'transparent',
        border: `1px ${dragOver ? 'dashed' : 'dashed'} ${dragOver ? style.dot : 'var(--border-default)'}`,
        opacity: dragOver ? 1 : 0.8,
      }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDragEnter={(e) => { e.preventDefault(); enterCount.current++; onDragEnter(status); }}
      onDragLeave={() => { enterCount.current--; if (enterCount.current <= 0) { enterCount.current = 0; onDragLeave(); } }}
      onDrop={(e) => { e.preventDefault(); enterCount.current = 0; onDrop(status); }}
    >
      {sessions.map((session) => (
        <KanbanCard key={`${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} onDragStart={onDragStart} />
      ))}
      {sessions.length === 0 && (
        <div className="text-center py-3 text-[10px]" style={{ color: 'var(--txt-3)' }}>—</div>
      )}
    </div>
  );
}

function KanbanBoard({ sessions, onNavigate, onStatusChange, groupByProject }: {
  sessions: RecentSession[];
  onNavigate: Props['onNavigate'];
  onStatusChange: (projectPath: string, sessionId: string, status: SessionStatus) => void;
  groupByProject: boolean;
}) {
  const { t } = useTranslation();
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set());
  const [savedCollapsed, setSavedCollapsed] = useState<Set<string> | null>(null);
  const [bulkState, setBulkState] = useState<'custom' | 'expanded' | 'collapsed'>('custom');
  const [currentProject, setCurrentProject] = useState<string | null>(null);
  const draggedRef = useRef<RecentSession | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const headerRef = useRef<HTMLDivElement>(null);

  const columns = useMemo(() => {
    const cols: Record<SessionStatus, RecentSession[]> = { active: [], idle: [], ended: [] };
    for (const s of sessions) cols[s.status].push(s);
    return cols;
  }, [sessions]);

  const projectRows = useMemo(() => {
    if (!groupByProject) return null;
    const groups = new Map<string, { projectName: string; cells: Record<SessionStatus, RecentSession[]> }>();
    for (const s of sessions) {
      const key = s.baseProjectName || s.projectName;
      if (!groups.has(key)) groups.set(key, { projectName: key, cells: { active: [], idle: [], ended: [] } });
      groups.get(key)!.cells[s.status].push(s);
    }
    return [...groups.entries()].sort((a, b) => {
      const aMax = Math.max(...Object.values(a[1].cells).flat().map(s => new Date(s.lastTimestamp).getTime()), 0);
      const bMax = Math.max(...Object.values(b[1].cells).flat().map(s => new Date(s.lastTimestamp).getTime()), 0);
      return bMax - aMax;
    });
  }, [sessions, groupByProject]);

  const handleDragStart = useCallback((session: RecentSession) => {
    draggedRef.current = session;
  }, []);

  const handleDrop = useCallback((targetStatus: SessionStatus) => {
    const dragged = draggedRef.current;
    if (dragged && dragged.status !== targetStatus) {
      onStatusChange(dragged.projectPath, dragged.id, targetStatus);
    }
    draggedRef.current = null;
    setDragOverCell(null);
  }, [onStatusChange]);

  const toggleRow = useCallback((key: string) => {
    setCollapsedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setBulkState('custom');
    setSavedCollapsed(null);
  }, []);

  const cycleBulkCollapse = useCallback(() => {
    if (!projectRows) return;
    const allKeys = projectRows.map(([k]) => k);
    setBulkState(curr => {
      if (curr === 'custom') {
        // custom → collapse all [v]
        setSavedCollapsed(new Set(collapsedRows));
        setCollapsedRows(new Set(allKeys));
        return 'collapsed';
      }
      if (curr === 'collapsed') {
        // collapsed → expand all [ ]
        setCollapsedRows(new Set());
        return 'expanded';
      }
      // expanded → restore [-]
      setCollapsedRows(savedCollapsed ?? new Set());
      setSavedCollapsed(null);
      return 'custom';
    });
  }, [projectRows, collapsedRows, savedCollapsed]);

  useEffect(() => {
    if (!groupByProject || !projectRows) { setCurrentProject(null); return; }
    const scrollParent = headerRef.current?.closest('.overflow-y-auto');
    if (!scrollParent) return;
    const handleScroll = () => {
      const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? 0;
      let found: string | null = null;
      for (const [key] of projectRows) {
        const el = rowRefs.current.get(key);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= headerBottom + 8) found = key;
      }
      setCurrentProject(found);
    };
    scrollParent.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => scrollParent.removeEventListener('scroll', handleScroll);
  }, [groupByProject, projectRows]);

  const STATUSES: SessionStatus[] = ['active', 'idle', 'ended'];

  if (groupByProject && projectRows) {
    return (
      <div>
        {/* Header row — sticky / 表头行 — 吸顶 */}
        <div
          ref={headerRef}
          className="grid grid-cols-[180px_1fr_1fr_1fr] gap-3 mb-3 sticky top-0 z-10 py-2 -mt-2"
          style={{ background: 'var(--surface-0, var(--bg-main, #fff))' }}
        >
          <div className="flex items-center gap-2 px-2">
            <button
              onClick={cycleBulkCollapse}
              className="p-1 rounded hover:scale-110 transition-transform flex-shrink-0"
              style={{ color: bulkState === 'collapsed' ? 'var(--status-ok)' : bulkState === 'expanded' ? 'var(--txt-3)' : 'var(--accent)' }}
              title={
                bulkState === 'custom' ? t('recent.kanban_collapse_all')
                : bulkState === 'collapsed' ? t('recent.kanban_expand_all')
                : t('recent.kanban_restore')
              }
            >
              {bulkState === 'collapsed' ? <CheckSquare size={14} />
                : bulkState === 'expanded' ? <Square size={14} />
                : <MinusSquare size={14} />}
            </button>
            <FolderOpen size={13} style={{ color: 'var(--accent)' }} />
            <span className="text-[12px] font-bold truncate" style={{ color: currentProject ? 'var(--txt-1)' : 'var(--txt-2)' }}>
              {currentProject || t('recent.group_by_project')}
            </span>
          </div>
          {STATUSES.map((status) => {
            const style = STATUS_STYLES[status];
            return (
              <div key={status} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: style.bg }}>
                <span className={`w-[7px] h-[7px] rounded-full ${status === 'active' ? 'animate-pulse' : ''}`} style={{ background: style.dot }} />
                <span className="text-[12px] font-bold" style={{ color: style.text }}>{t(`recent.status_${status}`)}</span>
              </div>
            );
          })}
        </div>
        {/* Project rows / 项目行 */}
        {projectRows.map(([key, row]) => {
          const collapsed = collapsedRows.has(key);
          const totalCount = Object.values(row.cells).flat().length;
          return (
            <div key={key} className="mb-3" ref={(el) => { if (el) rowRefs.current.set(key, el); else rowRefs.current.delete(key); }}>
              <div className="grid grid-cols-[180px_1fr_1fr_1fr] gap-3">
                <div
                  className="flex items-start gap-2 pt-2 px-2 min-w-0 cursor-pointer select-none group/row"
                  onClick={() => toggleRow(key)}
                >
                  <span className="transition-transform" style={{ color: 'var(--txt-3)' }}>
                    {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </span>
                  <span style={{ color: 'var(--accent)' }} className="flex-shrink-0">
                    {collapsed ? <FolderClosed size={13} /> : <FolderOpen size={13} />}
                  </span>
                  <span className="text-[12px] font-bold truncate group-hover/row:text-[color:var(--accent)] transition-colors" style={{ color: 'var(--txt-1)' }} title={row.projectName}>{row.projectName}</span>
                  <span className="text-[10px] font-medium px-1.5 rounded-full ml-auto" style={{ background: 'var(--surface-2)', color: 'var(--txt-3)' }}>{totalCount}</span>
                </div>
                {!collapsed && STATUSES.map((status) => (
                  <KanbanCell
                    key={status}
                    status={status}
                    sessions={row.cells[status]}
                    onNavigate={onNavigate}
                    onDragStart={handleDragStart}
                    dragOver={dragOverCell === `${key}/${status}`}
                    onDragEnter={() => setDragOverCell(`${key}/${status}`)}
                    onDragLeave={() => setDragOverCell(null)}
                    onDrop={handleDrop}
                  />
                ))}
                {collapsed && (
                  <div className="col-span-3 flex items-center px-3 py-2 text-[11px]" style={{ color: 'var(--txt-3)' }}>
                    {STATUSES.map(s => {
                      const count = row.cells[s].length;
                      if (!count) return null;
                      const st = STATUS_STYLES[s];
                      return (
                        <span key={s} className="inline-flex items-center gap-1 mr-4">
                          <span className="w-[6px] h-[6px] rounded-full" style={{ background: st.dot }} />
                          <span style={{ color: st.text }}>{count}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {STATUSES.map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          sessions={columns[status]}
          onNavigate={onNavigate}
          onDragStart={handleDragStart}
          dragOver={dragOverCell === status}
          onDragEnter={(s) => setDragOverCell(s)}
          onDragLeave={() => setDragOverCell(null)}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}

const makePinKey = (projectId: string, sessionId: string) => `${projectId}/${sessionId}`;

export default function RecentPanel({ onNavigate }: Props) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [spinning, setSpinning] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [statusFilter, setStatusFilter] = useState<SessionStatus | 'all'>('all');
  const [groupByProject, setGroupByProject] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [pinnedSet, setPinnedSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    pinsApi.list().then(({ pins }) => {
      setPinnedSet(new Set(pins.map(p => makePinKey(p.projectId, p.sessionId))));
    }).catch(() => { /* ignore */ });
  }, []);

  const handleTogglePin = useCallback(async (projectId: string, sessionId: string) => {
    const key = makePinKey(projectId, sessionId);
    const wasPinned = pinnedSet.has(key);
    // Optimistic update / 乐观更新
    setPinnedSet(prev => {
      const n = new Set(prev);
      if (wasPinned) n.delete(key); else n.add(key);
      return n;
    });
    try {
      if (wasPinned) await pinsApi.remove(projectId, sessionId);
      else await pinsApi.add(projectId, sessionId);
    } catch {
      // Revert on failure / 失败回滚
      setPinnedSet(prev => {
        const n = new Set(prev);
        if (wasPinned) n.add(key); else n.delete(key);
        return n;
      });
    }
  }, [pinnedSet]);

  const toggleCollapse = useCallback((projectPath: string) => {
    setCollapsedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectPath)) next.delete(projectPath);
      else next.add(projectPath);
      return next;
    });
  }, []);

  const load = useCallback(async (h: number, signal?: AbortSignal) => {
    setLoading(true);
    try {
      const { sessions: list } = await recentApi.list(h, signal);
      setSessions(list);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('Failed to load recent sessions:', err);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(hours, ac.signal);
    return () => ac.abort();
  }, [hours, load]);

  const handleRefresh = () => {
    setSpinning(true);
    load(hours).finally(() => setTimeout(() => setSpinning(false), 600));
  };

  const handleStatusChange = useCallback(async (projectPath: string, sessionId: string, status: SessionStatus) => {
    setSessions(prev => prev.map(s =>
      s.projectPath === projectPath && s.id === sessionId ? { ...s, status } : s
    ));
    await recentApi.updateStatus(projectPath, sessionId, status).catch(console.error);
  }, []);

  const sortedSessions = useMemo(() => {
    const filtered = statusFilter === 'all' ? sessions : sessions.filter(s => s.status === statusFilter);
    return [...filtered].sort((a, b) => {
      const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (so !== 0) return so;
      return b.lastTimestamp.localeCompare(a.lastTimestamp);
    });
  }, [sessions, statusFilter]);

  const maxTokens = useMemo(() => {
    let max = 1;
    for (const s of sessions) {
      const t = (s.totalTokens.input_tokens || 0) + (s.totalTokens.output_tokens || 0);
      if (t > max) max = t;
    }
    return max;
  }, [sessions]);

  // Pinned sessions are pulled out of every other view and rendered first.
  // 置顶会话从其他视图剥离，统一在顶部展示
  const pinnedSessions = useMemo(() => {
    if (pinnedSet.size === 0) return [];
    return sessions
      .filter(s => pinnedSet.has(makePinKey(s.projectPath, s.id)))
      .sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));
  }, [sessions, pinnedSet]);

  const unpinnedSorted = useMemo(
    () => sortedSessions.filter(s => !pinnedSet.has(makePinKey(s.projectPath, s.id))),
    [sortedSessions, pinnedSet],
  );

  const unpinnedKanbanSessions = useMemo(
    () => sessions.filter(s => !pinnedSet.has(makePinKey(s.projectPath, s.id))),
    [sessions, pinnedSet],
  );

  const groupedSessions = useMemo(() => {
    if (!groupByProject) return null;
    const groups = new Map<string, { projectName: string; sessions: RecentSession[] }>();
    for (const s of unpinnedSorted) {
      const key = s.baseProjectName || s.projectName;
      if (!groups.has(key)) groups.set(key, { projectName: key, sessions: [] });
      groups.get(key)!.sessions.push(s);
    }
    return [...groups.entries()].sort((a, b) => {
      const aLatest = a[1].sessions[0]?.lastTimestamp || '';
      const bLatest = b[1].sessions[0]?.lastTimestamp || '';
      return bLatest.localeCompare(aLatest);
    });
  }, [unpinnedSorted, groupByProject]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-10 pt-10 pb-6 max-w-6xl mx-auto">
        {/* Header / 标题 */}
        <div className="flex items-end justify-between gap-4 mb-8">
          <div className="flex items-center gap-5">
            <div
              className="p-4 rounded-2xl flex-shrink-0"
              style={{
                background: 'var(--gradient-accent)',
                boxShadow: '0 12px 32px -8px var(--accent-glow), 0 4px 12px rgba(0,0,0,0.08)',
              }}
            >
              <Clock size={28} style={{ color: '#fff' }} />
            </div>
            <div>
              <h1 className="text-4xl font-bold tracking-tight" style={{ color: 'var(--txt-1)', letterSpacing: '-0.035em' }}>
                {t('recent.title')}
              </h1>
              <p className="text-[15px] mt-1" style={{ color: 'var(--txt-2)' }}>
                {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} across all projects
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Group by project toggle / 按项目分组切换 */}
            <button
              onClick={() => setGroupByProject(g => !g)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all"
              style={{
                border: '1px solid var(--border-default)',
                background: groupByProject ? 'var(--accent-muted)' : 'transparent',
                color: groupByProject ? 'var(--accent)' : 'var(--txt-3)',
              }}
              title={t('recent.group_by_project')}
            >
              <Layers size={14} />
              {t('recent.group_by_project')}
            </button>

            {/* View mode toggle / 视图切换 */}
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
              <button
                onClick={() => setViewMode('list')}
                className="p-2 transition-colors"
                style={{
                  background: viewMode === 'list' ? 'var(--accent-muted)' : 'transparent',
                  color: viewMode === 'list' ? 'var(--accent)' : 'var(--txt-3)',
                }}
                title={t('recent.view_list')}
              >
                <List size={16} />
              </button>
              <button
                onClick={() => setViewMode('board')}
                className="p-2 transition-colors"
                style={{
                  background: viewMode === 'board' ? 'var(--accent-muted)' : 'transparent',
                  color: viewMode === 'board' ? 'var(--accent)' : 'var(--txt-3)',
                }}
                title={t('recent.view_board')}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className="p-2 transition-colors"
                style={{
                  background: viewMode === 'kanban' ? 'var(--accent-muted)' : 'transparent',
                  color: viewMode === 'kanban' ? 'var(--accent)' : 'var(--txt-3)',
                }}
                title={t('recent.view_kanban')}
              >
                <Columns size={16} />
              </button>
            </div>

            <button
              onClick={handleRefresh}
              className="btn btn-ghost p-2.5 rounded-xl"
              title={t('recent.refresh')}
              disabled={loading}
            >
              <RefreshCw size={18} className={spinning ? 'animate-spin' : ''} style={{ color: 'var(--txt-2)' }} />
            </button>
          </div>
        </div>

        {/* Range filter pills / 时间范围筛选 */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => setHours(r.hours)}
              className={`inline-flex items-center px-4 py-2 rounded-full text-[13px] font-semibold cursor-pointer transition-all ${hours === r.hours ? 'badge-tool' : ''}`}
              style={hours !== r.hours ? { background: 'var(--surface-2)', color: 'var(--txt-2)' } : {}}
            >
              {t(r.labelKey)}
            </button>
          ))}
        </div>

        {/* Status filter pills / 状态筛选 */}
        <div className="flex items-center gap-2 mb-8 flex-wrap">
          {(['all', 'active', 'idle', 'ended'] as const).map((s) => {
            const isActive = statusFilter === s;
            const style = s !== 'all' ? STATUS_STYLES[s] : null;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold cursor-pointer transition-all ${isActive ? 'ring-1' : ''}`}
                style={{
                  background: isActive && style ? style.bg : 'var(--surface-2)',
                  color: isActive && style ? style.text : isActive ? 'var(--accent)' : 'var(--txt-3)',
                  ringColor: isActive ? 'currentColor' : undefined,
                }}
              >
                {style && (
                  <span className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: style.dot }} />
                )}
                {s === 'all' ? t('recent.status_all') : t(`recent.status_${s}`)}
              </button>
            );
          })}
        </div>

        {/* Loading / 加载中 */}
        {loading && sessions.length === 0 && (
          <div className="empty-state">
            <div className="w-8 h-8 rounded-lg animate-pulse-slow" style={{ background: 'var(--accent-muted)' }} />
            <p className="text-sm mt-3" style={{ color: 'var(--txt-3)' }}>{t('common.loading')}</p>
          </div>
        )}

        {/* Empty / 空状态 */}
        {!loading && sessions.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Clock size={32} />
            </div>
            <p className="text-[15px] mt-2">{t('recent.no_sessions')}</p>
          </div>
        )}

        {/* Pinned section — always at top, regardless of viewMode/groupByProject */}
        {/* 置顶区域 — 总是显示在顶部，与视图模式和分组无关 */}
        {pinnedSessions.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Pin size={15} style={{ color: 'var(--accent)' }} />
              <h2 className="text-[14px] font-bold" style={{ color: 'var(--accent)' }}>{t('recent.pinned')}</h2>
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                {pinnedSessions.length}
              </span>
            </div>
            {viewMode === 'list' ? (
              <div className="space-y-3.5">
                {pinnedSessions.map((session) => (
                  <ListRow key={`pin-${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} maxTokens={maxTokens} pinned={true} onTogglePin={handleTogglePin} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {pinnedSessions.map((session) => (
                  <BoardCard key={`pin-${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} pinned={true} onTogglePin={handleTogglePin} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Kanban view / 看板视图 */}
        {viewMode === 'kanban' && sessions.length > 0 && (
          <KanbanBoard sessions={unpinnedKanbanSessions} onNavigate={onNavigate} onStatusChange={handleStatusChange} groupByProject={groupByProject} />
        )}

        {/* Board view / 卡片视图 */}
        {viewMode === 'board' && unpinnedSorted.length > 0 && !groupByProject && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {unpinnedSorted.map((session) => (
              <BoardCard key={`${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} pinned={false} onTogglePin={handleTogglePin} />
            ))}
          </div>
        )}

        {/* Board view grouped / 卡片视图（按项目分组） */}
        {viewMode === 'board' && groupedSessions && (
          <div className="space-y-6">
            {groupedSessions.map(([projectPath, group]) => {
              const collapsed = collapsedProjects.has(projectPath);
              return (
                <div key={projectPath}>
                  <div
                    className="flex items-center gap-2 mb-4 cursor-pointer select-none group/header sticky top-0 z-10 py-2 -mt-2 rounded-lg px-2"
                    style={{ background: 'var(--surface-0, var(--bg-main, #fff))' }}
                    onClick={() => toggleCollapse(projectPath)}
                  >
                    <span
                      className="p-1.5 rounded-lg transition-all group-hover/header:scale-110"
                      style={{
                        background: collapsed ? 'var(--surface-2)' : 'var(--accent-muted)',
                        color: collapsed ? 'var(--txt-3)' : 'var(--accent)',
                      }}
                    >
                      {collapsed ? <FolderClosed size={16} /> : <FolderOpen size={16} />}
                    </span>
                    <h2 className="text-[15px] font-bold" style={{ color: 'var(--txt-1)' }}>{group.projectName}</h2>
                    <span className="text-[12px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--txt-3)' }}>
                      {group.sessions.length}
                    </span>
                    <span className="ml-auto transition-transform" style={{ color: 'var(--txt-3)' }}>
                      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </div>
                  {!collapsed && (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {group.sessions.map((session) => (
                        <BoardCard key={`${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} pinned={false} onTogglePin={handleTogglePin} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* List view / 列表视图 */}
        {viewMode === 'list' && unpinnedSorted.length > 0 && !groupByProject && (
          <div className="space-y-3.5">
            {unpinnedSorted.map((session) => (
              <ListRow key={`${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} maxTokens={maxTokens} pinned={false} onTogglePin={handleTogglePin} />
            ))}
          </div>
        )}

        {/* List view grouped / 列表视图（按项目分组） */}
        {viewMode === 'list' && groupedSessions && (
          <div className="space-y-6">
            {groupedSessions.map(([projectPath, group]) => {
              const collapsed = collapsedProjects.has(projectPath);
              return (
                <div key={projectPath}>
                  <div
                    className="flex items-center gap-2 mb-4 cursor-pointer select-none group/header sticky top-0 z-10 py-2 -mt-2 rounded-lg px-2"
                    style={{ background: 'var(--surface-0, var(--bg-main, #fff))' }}
                    onClick={() => toggleCollapse(projectPath)}
                  >
                    <span
                      className="p-1.5 rounded-lg transition-all group-hover/header:scale-110"
                      style={{
                        background: collapsed ? 'var(--surface-2)' : 'var(--accent-muted)',
                        color: collapsed ? 'var(--txt-3)' : 'var(--accent)',
                      }}
                    >
                      {collapsed ? <FolderClosed size={16} /> : <FolderOpen size={16} />}
                    </span>
                    <h2 className="text-[15px] font-bold" style={{ color: 'var(--txt-1)' }}>{group.projectName}</h2>
                    <span className="text-[12px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-2)', color: 'var(--txt-3)' }}>
                      {group.sessions.length}
                    </span>
                    <span className="ml-auto transition-transform" style={{ color: 'var(--txt-3)' }}>
                      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </div>
                  {!collapsed && (
                    <div className="space-y-3.5">
                      {group.sessions.map((session) => (
                        <ListRow key={`${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} maxTokens={maxTokens} pinned={false} onTogglePin={handleTogglePin} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
