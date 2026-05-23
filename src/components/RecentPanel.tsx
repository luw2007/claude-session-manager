/**
 * Recent sessions panel / 最近会话面板
 * Cross-project view with list and board (kanban) modes
 * 跨项目查看，支持列表和看板两种视图
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock, MessageSquare, GitBranch, Bot, RefreshCw,
  FolderOpen, FolderClosed, List, LayoutGrid, Layers, ChevronDown, ChevronRight,
} from 'lucide-react';
import { recent as recentApi, type RecentSession, type SessionStatus } from '../utils/api';

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

type ViewMode = 'list' | 'board';

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

function BoardCard({ session, onNavigate }: { session: RecentSession; onNavigate: Props['onNavigate'] }) {
  return (
    <div
      onClick={() => onNavigate(session.projectPath, session.id)}
      className="group card p-5 cursor-pointer hover:translate-y-[-2px] animate-fade-in flex flex-col"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
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

function ListRow({ session, onNavigate, maxTokens }: { session: RecentSession; onNavigate: Props['onNavigate']; maxTokens: number }) {
  const { t } = useTranslation();
  const totalTokens = (session.totalTokens.input_tokens || 0) + (session.totalTokens.output_tokens || 0);
  const tokenPct = Math.round((totalTokens / maxTokens) * 100);

  return (
    <div
      onClick={() => onNavigate(session.projectPath, session.id)}
      className="group card p-6 cursor-pointer hover:translate-y-[-2px] animate-fade-in"
    >
      <div className="flex items-start justify-between gap-4">
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

  const groupedSessions = useMemo(() => {
    if (!groupByProject) return null;
    const groups = new Map<string, { projectName: string; sessions: RecentSession[] }>();
    for (const s of sortedSessions) {
      const key = s.baseProjectName || s.projectName;
      if (!groups.has(key)) groups.set(key, { projectName: key, sessions: [] });
      groups.get(key)!.sessions.push(s);
    }
    return [...groups.entries()].sort((a, b) => {
      const aLatest = a[1].sessions[0]?.lastTimestamp || '';
      const bLatest = b[1].sessions[0]?.lastTimestamp || '';
      return bLatest.localeCompare(aLatest);
    });
  }, [sortedSessions, groupByProject]);

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

        {/* Board view / 看板视图 */}
        {viewMode === 'board' && sortedSessions.length > 0 && !groupByProject && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sortedSessions.map((session) => (
              <BoardCard key={`${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} />
            ))}
          </div>
        )}

        {/* Board view grouped / 看板视图（按项目分组） */}
        {viewMode === 'board' && groupedSessions && (
          <div className="space-y-6">
            {groupedSessions.map(([projectPath, group]) => {
              const collapsed = collapsedProjects.has(projectPath);
              return (
                <div key={projectPath}>
                  <div
                    className="flex items-center gap-2 mb-4 cursor-pointer select-none group/header"
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
                        <BoardCard key={`${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* List view / 列表视图 */}
        {viewMode === 'list' && sortedSessions.length > 0 && !groupByProject && (
          <div className="space-y-3.5">
            {sortedSessions.map((session) => (
              <ListRow key={`${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} maxTokens={maxTokens} />
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
                    className="flex items-center gap-2 mb-4 cursor-pointer select-none group/header"
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
                        <ListRow key={`${session.projectPath}/${session.id}`} session={session} onNavigate={onNavigate} maxTokens={maxTokens} />
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
