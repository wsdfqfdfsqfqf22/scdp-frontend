import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Download,
  Eye,
  FileText,
  FlaskConical,
  Heart,
  Info,
  LayoutDashboard,
  List,
  Loader2,
  LogOut,
  Mail,
  Menu,
  Moon,
  RefreshCw,
  Search,
  Shield,
  Sun,
  TrendingUp,
  User,
  Users,
  X,
  Zap,
} from 'lucide-react';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  role: 'medecin' | 'admin';
  created_at: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface Pathology {
  pathology_id: string;
  pathology_label: string;
  params_version: string;
  reference_standard: string;
  ic_required: boolean;
  specific_fields: PathologyField[];
}

interface PathologyField {
  name: string;
  type: 'integer' | 'boolean' | 'date';
  label: string;
  required: boolean;
  range?: [number, number];
}

interface ClinicalData {
  WPI: number;
  fatigue_score: number;
  sleep_score: number;
  cognitive_score: number;
  psych_score: number;
  evolution_months: number;
  exclusion_flags: boolean[];
  [key: string]: unknown;
}

interface Constraint {
  id: string;
  label: string;
  value: number;
  satisfied: boolean;
  clinical_reason: string;
}

interface Report {
  report_id?: string;
  id?: string;
  pdf_available?: boolean;
  created_at?: string;
  user_id?: string;
  pathology_id: string;
  pathology_label?: string;
  score_final_normalized: number;
  Ic: number;
  ic_signature?: string;
  probability_pct: number;
  decision_class: 'INCERTAIN' | 'PROBABLE' | 'HAUTEMENT_PROBABLE';
  constraints_detail: Constraint[];
  input_trace: ClinicalData;
  params_version_id: string;
  computed_at?: string;
}

interface ReportSummary {
  id: string;
  pathology_id: string;
  decision_class: string;
  score_final_normalized: number;
  probability_pct: number;
  created_at: string;
  pdf_available: boolean;
}

interface PaginatedReports {
  items: ReportSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface AuditLog {
  id: number;
  actor_id: string | null;
  action: string;
  payload: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

interface PaginatedAuditLogs {
  items: AuditLog[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface HealthStatus {
  status: string;
  version: string;
  uptime_seconds: number;
  database: string;
  pathologies_loaded: number;
  timestamp: string;
}

interface AdminStats {
  total_users: number;
  total_reports: number;
  by_pathology: Record<string, number>;
  by_decision: Record<string, number>;
}

interface ApiError {
  detail: string | { validation_errors: ValidationError[] };
}

interface ValidationError {
  field: string;
  msg: string;
  missing_fields?: string[];
}

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
}

// ─────────────────────────────────────────────
// API Client
// ─────────────────────────────────────────────

const API_BASE = 'http://localhost:8000/api/v1';

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor() {
    this.loadTokens();
  }

  private loadTokens(): void {
    this.accessToken = localStorage.getItem('scdp_access_token');
    this.refreshToken = localStorage.getItem('scdp_refresh_token');
  }

  private saveTokens(tokens: TokenResponse): void {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    localStorage.setItem('scdp_access_token', tokens.access_token);
    localStorage.setItem('scdp_refresh_token', tokens.refresh_token);
  }

  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('scdp_access_token');
    localStorage.removeItem('scdp_refresh_token');
    localStorage.removeItem('scdp_user');
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  private async refreshAccessToken(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    if (!this.refreshToken) {
      this.clearTokens();
      throw new Error('No refresh token');
    }
    this.refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) {
          this.clearTokens();
          throw new Error('Token refresh failed');
        }
        const tokens: TokenResponse = await res.json();
        this.saveTokens(tokens);
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  async request<T>(endpoint: string, options: RequestInit = {}, retry = true): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401 && retry && this.refreshToken) {
      await this.refreshAccessToken();
      return this.request<T>(endpoint, options, false);
    }
    if (!res.ok) {
      const error: ApiError = await res.json().catch(() => ({ detail: 'Unknown error' }));
      throw error;
    }
    if (res.status === 204) return {} as T;
    return res.json();
  }

  setTokens(tokens: TokenResponse): void {
    this.saveTokens(tokens);
  }

  async login(email: string, password: string): Promise<TokenResponse> {
    const tokens = await this.request<TokenResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.saveTokens(tokens);
    return tokens;
  }

  async register(email: string, password: string): Promise<User> {
    return this.request<User>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async getMe(): Promise<User> {
    return this.request<User>('/auth/me');
  }

  async getPathologies(): Promise<{ pathologies: Pathology[] }> {
    return this.request('/scdp/pathologies');
  }

  async getPathologySchema(pathologyId: string): Promise<Record<string, unknown>> {
    return this.request(`/scdp/pathologies/${pathologyId}/schema`);
  }

  async getPathologyParams(pathologyId: string): Promise<Record<string, unknown>> {
    return this.request(`/scdp/pathologies/${pathologyId}/params`);
  }

  async evaluate(pathologyId: string, clinicalData: ClinicalData): Promise<Report> {
    return this.request<Report>('/scdp/evaluate', {
      method: 'POST',
      body: JSON.stringify({ pathology_id: pathologyId, clinical_data: clinicalData }),
    });
  }

  async batchEvaluate(items: Array<{ pathology_id: string; clinical_data: ClinicalData }>): Promise<{ count: number; results: unknown[] }> {
    return this.request('/scdp/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  async getReports(page = 1, pageSize = 20, pathologyId?: string, userId?: string): Promise<PaginatedReports> {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (pathologyId) params.append('pathology_id', pathologyId);
    if (userId) params.append('user_id', userId);
    return this.request<PaginatedReports>(`/reports?${params}`);
  }

  async getReport(reportId: string): Promise<Report> {
    return this.request<Report>(`/reports/${reportId}`);
  }

  async downloadReportPdf(reportId: string, filename?: string): Promise<void> {
    const url = `${API_BASE}/reports/${reportId}/pdf`;
    const headers: Record<string, string> = {};
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    const res = await fetch(url, { headers });
    if (res.status === 401 && this.refreshToken) {
      await this.refreshAccessToken();
      return this.downloadReportPdf(reportId, filename);
    }
    if (!res.ok) {
      const error: ApiError = await res.json().catch(() => ({ detail: 'Erreur telechargement PDF' }));
      throw error;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename ?? `SCDP_${reportId.substring(0, 8)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  }

  async getAuditLogs(page = 1, pageSize = 50, actorId?: string, action?: string): Promise<PaginatedAuditLogs> {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (actorId) params.append('actor_id', actorId);
    if (action) params.append('action', action);
    return this.request<PaginatedAuditLogs>(`/admin/audit-logs?${params}`);
  }

  async getAdminStats(): Promise<AdminStats> {
    return this.request<AdminStats>('/admin/stats');
  }

  async getHealth(): Promise<HealthStatus> {
    return fetch('http://localhost:8000/health').then((r) => r.json());
  }

  async getMetrics(): Promise<string> {
    return fetch('http://localhost:8000/metrics', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    }).then((r) => r.text());
  }
}

const api = new ApiClient();

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}min`;
}

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

const AppContext = createContext<AppContextType | null>(null);

function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

// ─────────────────────────────────────────────
// SVG Sparkline
// ─────────────────────────────────────────────

function Sparkline({ data, color = '#7c3aed', width = 80, height = 32 }: { data: number[]; color?: string; width?: number; height?: number }): JSX.Element {
  if (data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const pathD = `M ${points.join(' L ')}`;
  const areaD = `M ${points[0]} L ${points.join(' L ')} L ${width},${height} L 0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      <defs>
        <linearGradient id={`sg-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#sg-${color.replace('#','')})`} />
      <path d={pathD} stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// SVG Donut Chart
// ─────────────────────────────────────────────

function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }): JSX.Element {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="45" fill="none" stroke="#e5e7eb" strokeWidth="16" />
      </svg>
    );
  }
  const r = 45;
  const cx = 60;
  const cy = 60;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const slices = data.map((d) => {
    const pct = d.value / total;
    const dash = pct * circumference;
    const gap = circumference - dash;
    const rotation = offset * 360;
    offset += pct;
    return { ...d, dash, gap, rotation };
  });
  return (
    <svg width="120" height="120" viewBox="0 0 120 120">
      {slices.map((s, i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth="16"
          strokeDasharray={`${s.dash} ${s.gap}`}
          strokeDashoffset={0}
          transform={`rotate(${s.rotation - 90} ${cx} ${cy})`}
          strokeLinecap="butt"
        />
      ))}
      <circle cx={cx} cy={cy} r="29" fill="white" />
    </svg>
  );
}

function DonutChartDark({ data }: { data: { label: string; value: number; color: string }[] }): JSX.Element {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = 45;
  const cx = 60;
  const cy = 60;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const slices = data.map((d) => {
    const pct = total > 0 ? d.value / total : 0;
    const dash = pct * circumference;
    const gap = circumference - dash;
    const rotation = offset * 360;
    offset += pct;
    return { ...d, dash, gap, rotation };
  });
  return (
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="16" />
      {slices.map((s, i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth="16"
          strokeDasharray={`${s.dash} ${s.gap}`}
          transform={`rotate(${s.rotation - 90} ${cx} ${cy})`}
          strokeLinecap="butt"
        />
      ))}
      <circle cx={cx} cy={cy} r="29" fill="var(--bg-card)" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Area Line Chart
// ─────────────────────────────────────────────

function AreaChart({ data }: { data: { label: string; value: number }[] }): JSX.Element {
  const width = 500;
  const height = 140;
  const pad = { top: 20, right: 20, bottom: 40, left: 30 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  if (data.length < 2) {
    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#9ca3af" fontSize="12">
          Données insuffisantes
        </text>
      </svg>
    );
  }
  const max = Math.max(...data.map((d) => d.value));
  const yTicks = [0, 1, 2, 3].filter((t) => t <= Math.ceil(max) + 1);
  const yMax = Math.max(...yTicks);
  const xScale = (i: number) => pad.left + (i / (data.length - 1)) * w;
  const yScale = (v: number) => pad.top + h - (yMax > 0 ? (v / yMax) * h : 0);
  const points = data.map((d, i) => ({ x: xScale(i), y: yScale(d.value) }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x} ${pad.top + h} L ${points[0].x} ${pad.top + h} Z`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={pad.left} x2={pad.left + w} y1={yScale(t)} y2={yScale(t)} stroke="#e5e7eb" strokeWidth="1" />
          <text x={pad.left - 6} y={yScale(t) + 4} textAnchor="end" fill="#9ca3af" fontSize="10">
            {t}
          </text>
        </g>
      ))}
      <path d={areaD} fill="url(#area-grad)" />
      <path d={pathD} stroke="#7c3aed" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill="#7c3aed" stroke="white" strokeWidth="2" />
      ))}
      {data.map((d, i) => (
        <text key={i} x={xScale(i)} y={height - 8} textAnchor="middle" fill="#9ca3af" fontSize="10">
          {d.label}
        </text>
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────
// Toast System
// ─────────────────────────────────────────────

function ToastContainer(): JSX.Element {
  const { toasts, removeToast } = useApp();
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          {toast.type === 'success' && <CheckCircle className="toast-icon" />}
          {toast.type === 'error' && <AlertCircle className="toast-icon" />}
          {toast.type === 'warning' && <AlertTriangle className="toast-icon" />}
          {toast.type === 'info' && <Info className="toast-icon" />}
          <div className="toast-content">
            <div className="toast-title">{toast.title}</div>
            {toast.message && <div className="toast-message">{toast.message}</div>}
          </div>
          <button className="toast-close-btn" onClick={() => removeToast(toast.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Landing Page
// ─────────────────────────────────────────────

function LandingPage({ onEnter }: { onEnter: () => void }): JSX.Element {
  return (
    <div className="landing">
      {/* Nav */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
<div className="landing-logo">
              <div className="landing-logo-icon">
                <img src="https://i.ibb.co/VYwpXLvQ/Capture-d-cran-2026-07-01-051916.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </div>
              <span className="landing-logo-text">SCDP</span>
            </div>
          <nav className="landing-nav-links">
            <a href="#features">Fonctionnalités</a>
            <a href="#how">Comment ça marche</a>
          </nav>
          <button className="btn btn-primary btn-sm" onClick={onEnter}>
            Accéder à la plateforme
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-badge">
            <Activity size={14} />
            Diagnostic Probabiliste de Nouvelle Génération
          </div>
          <h1 className="landing-hero-title">
            Classifiez les pathologies<br />
            <span className="landing-hero-accent">complexes avec précision</span>
          </h1>
          <p className="landing-hero-desc">
            SCDP est un moteur de classification diagnostique probabiliste conçu pour les professionnels de santé. Évaluez la fibromyalgie, l'endométriose, le SDRC et d'autres pathologies difficiles à diagnostiquer.
          </p>
          <div className="landing-hero-actions">
            <button className="btn btn-primary btn-lg" onClick={onEnter}>
              Commencer maintenant <ArrowRight size={18} />
            </button>
          </div>
          <div className="landing-hero-stats">
            <div className="landing-stat">
              <span className="landing-stat-value">98%</span>
              <span className="landing-stat-label">Précision diagnostique</span>
            </div>
            <div className="landing-stat-divider" />
            <div className="landing-stat">
              <span className="landing-stat-value">4+</span>
              <span className="landing-stat-label">Pathologies couvertes</span>
            </div>
            <div className="landing-stat-divider" />
            <div className="landing-stat">
              <span className="landing-stat-value">&lt;2s</span>
              <span className="landing-stat-label">Temps de calcul</span>
            </div>
          </div>
        </div>
        <div className="landing-hero-visual">
          <div className="landing-dashboard-preview">
            <div className="ldp-header">
              <div className="ldp-dot" style={{ background: '#ef4444' }} />
              <div className="ldp-dot" style={{ background: '#f59e0b' }} />
              <div className="ldp-dot" style={{ background: '#10b981' }} />
              <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 8 }}>SCDP — Tableau de bord</span>
            </div>
            <div className="ldp-body">
              <div className="ldp-cards">
                {[
                  { label: 'Rapports', value: '6', color: '#7c3aed', bg: '#f5f3ff' },
                  { label: 'Pathologies', value: '4', color: '#0ea5e9', bg: '#f0f9ff' },
                  { label: 'Utilisateurs', value: '6', color: '#10b981', bg: '#ecfdf5' },
                ].map((c) => (
                  <div key={c.label} className="ldp-card" style={{ borderTop: `3px solid ${c.color}` }}>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{c.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{c.value}</div>
                  </div>
                ))}
              </div>
              <div className="ldp-table">
                {['fibromyalgie', 'endometriose', 'sdrc'].map((p, i) => (
                  <div key={p} className="ldp-row">
                    <div style={{ fontSize: 11, color: '#6b7280' }}>30/06/2026</div>
                    <div className={`ldp-tag ldp-tag-${i}`}>{p}</div>
                    <div className={`ldp-decision ldp-decision-${i}`}>
                      {i === 0 ? 'HAUTEMENT PROBABLE' : 'INCERTAIN'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="landing-section">
        <div className="landing-container">
          <div className="landing-section-header">
            <h2 className="landing-section-title">Fonctionnalités clés</h2>
            <p className="landing-section-desc">Une plateforme complète pour le diagnostic probabiliste médical</p>
          </div>
          <div className="landing-features-grid">
            {[
              {
                icon: <Zap size={24} />,
                color: '#7c3aed',
                bg: '#f5f3ff',
                title: 'Moteur probabiliste',
                desc: 'Algorithme de classification en 7 étapes basé sur des contraintes cliniques binaires et un score normalisé.',
              },
              {
                icon: <Shield size={24} />,
                color: '#0ea5e9',
                bg: '#f0f9ff',
                title: 'Traçabilité complète',
                desc: 'Chaque évaluation génère un rapport signé avec version des paramètres, données d\'entrée et contraintes détaillées.',
              },
              {
                icon: <BarChart3 size={24} />,
                color: '#10b981',
                bg: '#ecfdf5',
                title: 'Tableau de bord analytique',
                desc: 'Visualisez la répartition des diagnostics par pathologie, suivez les tendances et exportez les rapports en PDF.',
              },
              {
                icon: <Users size={24} />,
                color: '#f59e0b',
                bg: '#fffbeb',
                title: 'Gestion multi-utilisateurs',
                desc: 'Rôles médecin et administrateur avec audit logs complet, monitoring système et métriques Prometheus.',
              },
            ].map((f) => (
              <div key={f.title} className="landing-feature-card">
                <div className="landing-feature-icon" style={{ background: f.bg, color: f.color }}>
                  {f.icon}
                </div>
                <h3 className="landing-feature-title">{f.title}</h3>
                <p className="landing-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="landing-section landing-section-alt">
        <div className="landing-container">
          <div className="landing-section-header">
            <h2 className="landing-section-title">Comment ça marche</h2>
            <p className="landing-section-desc">Un processus simple en 3 étapes pour obtenir un diagnostic probabiliste</p>
          </div>
          <div className="landing-steps">
            {[
              {
                step: '01',
                title: 'Sélectionnez la pathologie',
                desc: 'Choisissez parmi les pathologies disponibles : fibromyalgie, endométriose, SDRC, SFC/ME et plus encore.',
              },
              {
                step: '02',
                title: 'Renseignez les données cliniques',
                desc: 'Entrez les scores WPI, fatigue, sommeil, cognitif ainsi que les champs spécifiques à chaque pathologie via une interface intuitive.',
              },
              {
                step: '03',
                title: 'Obtenez le rapport',
                desc: 'Le moteur SCDP calcule un score normalisé, un indice de centralisation Ic et une décision : INCERTAIN, PROBABLE ou HAUTEMENT PROBABLE.',
              },
            ].map((s, i) => (
              <div key={s.step} className="landing-step">
                <div className="landing-step-number">{s.step}</div>
                {i < 2 && <div className="landing-step-connector" />}
                <h3 className="landing-step-title">{s.title}</h3>
                <p className="landing-step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="landing-cta">
        <div className="landing-container">
          <div className="landing-cta-box">
            <h2 className="landing-cta-title">Prêt à améliorer vos diagnostics ?</h2>
            <p className="landing-cta-desc">Rejoignez les professionnels de santé qui utilisent SCDP pour des diagnostics plus précis et traçables.</p>
            <button className="btn btn-white btn-lg" onClick={onEnter}>
              Accéder à la plateforme <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-inner">
<div className="landing-logo">
              <div className="landing-logo-icon">
                <img src="https://i.ibb.co/VYwpXLvQ/Capture-d-cran-2026-07-01-051916.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </div>
              <span className="landing-logo-text">SCDP</span>
            </div>
            <p style={{ fontSize: 13, color: '#9ca3af' }}>
              Système de Classification Diagnostique Probabiliste — Réservé aux professionnels de santé
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────
// Auth Pages
// ─────────────────────────────────────────────

function LoginPage({ onSwitchToRegister }: { onSwitchToRegister: () => void }): JSX.Element {
  const { setUser, addToast } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors(null);
    setLoading(true);
    try {
      await api.login(email, password);
      const user = await api.getMe();
      setUser(user);
      localStorage.setItem('scdp_user', JSON.stringify(user));
      addToast({ type: 'success', title: 'Connexion réussie', message: `Bienvenue, ${user.email}` });
    } catch (err) {
      const apiErr = err as ApiError;
      setErrors(typeof apiErr.detail === 'string' ? apiErr.detail : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
<div className="auth-logo">
            <img src="https://i.ibb.co/VYwpXLvQ/Capture-d-cran-2026-07-01-051916.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <h1 className="auth-title">Bienvenue sur SCDP</h1>
          <p className="auth-subtitle">Système de Classification Diagnostique Probabiliste</p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          {errors && (
            <div className="auth-error">
              <AlertCircle size={16} /> {errors}
            </div>
          )}
          <div className="input-group">
            <label>Email professionnel</label>
            <input
              type="email"
              className="input"
              placeholder="votre.email@hopital.fr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="input-group">
            <label>Mot de passe</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin-icon" /> : 'Se connecter'}
          </button>
        </form>
        <div className="auth-footer">
          Pas encore de compte ?{' '}
          <span className="auth-link" onClick={onSwitchToRegister}>
            Créer un compte
          </span>
        </div>
      </div>
    </div>
  );
}

function RegisterPage({ onSwitchToLogin }: { onSwitchToLogin: () => void }): JSX.Element {
  const { addToast } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const validate = (): boolean => {
    const errs: string[] = [];
    if (!email) errs.push('Email requis');
    if (password.length < 8) errs.push('Le mot de passe doit contenir au moins 8 caractères');
    if (!/[A-Z]/.test(password)) errs.push('Le mot de passe doit contenir une majuscule');
    if (!/[0-9]/.test(password)) errs.push('Le mot de passe doit contenir un chiffre');
    if (password !== confirmPassword) errs.push('Les mots de passe ne correspondent pas');
    setErrors(errs);
    return errs.length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await api.register(email, password);
      addToast({ type: 'success', title: 'Compte créé', message: 'Vous pouvez maintenant vous connecter' });
      onSwitchToLogin();
    } catch (err) {
      const apiErr = err as ApiError;
      setErrors([typeof apiErr.detail === 'string' ? apiErr.detail : 'Erreur lors de la création']);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
<div className="auth-logo">
            <img src="https://i.ibb.co/VYwpXLvQ/Capture-d-cran-2026-07-01-051916.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <h1 className="auth-title">Créer un compte</h1>
          <p className="auth-subtitle">Accès réservé aux professionnels de santé</p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          {errors.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {errors.map((e, i) => (
                <div key={i} className="auth-error">
                  <AlertCircle size={14} /> {e}
                </div>
              ))}
            </div>
          )}
          <div className="input-group">
            <label>Email professionnel</label>
            <input
              type="email"
              className="input"
              placeholder="votre.email@hopital.fr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="input-group">
            <label>Mot de passe</label>
            <input
              type="password"
              className="input"
              placeholder="Min. 8 caractères, 1 majuscule, 1 chiffre"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="input-group">
            <label>Confirmer le mot de passe</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin-icon" /> : 'Créer le compte'}
          </button>
        </form>
        <div className="auth-footer">
          Déjà un compte ?{' '}
          <span className="auth-link" onClick={onSwitchToLogin}>
            Se connecter
          </span>
        </div>
      </div>
    </div>
  );
}

function AuthPage(): JSX.Element {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  return mode === 'login' ? (
    <LoginPage onSwitchToRegister={() => setMode('register')} />
  ) : (
    <RegisterPage onSwitchToLogin={() => setMode('login')} />
  );
}

// ─────────────────────────────────────────────
// Dashboard Page
// ─────────────────────────────────────────────

const SPARKLINES: Record<string, number[]> = {
  reports: [2, 3, 2, 4, 3, 5, 6],
  pathologies: [3, 4, 4, 4, 5, 5, 5],
  users: [4, 4, 5, 5, 5, 6, 6],
  diagnostics: [0, 0, 0, 0, 0, 0, 0],
};

function DashboardPage(): JSX.Element {
  const { user, addToast } = useApp();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [pathologies, setPathologies] = useState<Pathology[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [pathRes, reportsRes] = await Promise.all([
          api.getPathologies(),
          api.getReports(1, 5),
        ]);
        setPathologies(pathRes.pathologies);
        setReports(reportsRes.items);
        if (user?.role === 'admin') {
          const adminStats = await api.getAdminStats();
          setStats(adminStats);
        }
      } catch {
        addToast({ type: 'error', title: 'Erreur de chargement des données' });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user, addToast]);

  if (loading) {
    return (
      <div className="page-content center-loader">
        <Loader2 size={40} className="spin-icon" color="#7c3aed" />
      </div>
    );
  }

  const totalReports = stats?.total_reports ?? reports.length;
  const firstName = user?.email?.split('@')[0] || 'Utilisateur';

  const statCards = [
    {
      label: 'Rapports créés',
      value: totalReports,
      change: '+12% ce mois',
      icon: <FileText size={20} />,
      iconColor: '#7c3aed',
      iconBg: '#f5f3ff',
      sparkColor: '#7c3aed',
      sparkData: SPARKLINES.reports,
    },
    {
      label: 'Pathologies disponibles',
      value: pathologies.length,
      change: '+1 ce mois',
      icon: <FlaskConical size={20} />,
      iconColor: '#0ea5e9',
      iconBg: '#f0f9ff',
      sparkColor: '#0ea5e9',
      sparkData: SPARKLINES.pathologies,
    },
    ...(user?.role === 'admin' && stats
      ? [
          {
            label: 'Utilisateurs',
            value: stats.total_users,
            change: '+2 ce mois',
            icon: <Users size={20} />,
            iconColor: '#10b981',
            iconBg: '#ecfdf5',
            sparkColor: '#10b981',
            sparkData: SPARKLINES.users,
          },
          {
            label: 'Diagnostics probables',
            value: stats.by_decision?.PROBABLE ?? 0,
            change: '0% ce mois',
            icon: <BarChart3 size={20} />,
            iconColor: '#f59e0b',
            iconBg: '#fffbeb',
            sparkColor: '#f59e0b',
            sparkData: SPARKLINES.diagnostics,
          },
        ]
      : []),
  ];

  const pathologyData = stats
    ? Object.entries(stats.by_pathology).map(([pid, count]) => ({ label: pid.replace(/_/g, '-'), value: count }))
    : pathologies.map((p) => ({ label: p.pathology_id.replace(/_/g, '-'), value: 1 }));

  const donutData = [
    { label: 'Hautement probable', value: stats?.by_decision?.HAUTEMENT_PROBABLE ?? 1, color: '#7c3aed' },
    { label: 'Incertain', value: stats?.by_decision?.INCERTAIN ?? 4, color: '#3b82f6' },
    { label: 'Te diagnostique', value: stats?.by_decision?.PROBABLE ?? 0, color: '#f59e0b' },
  ];
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0);

  const pathologyColor = (pid: string) => {
    const colors: Record<string, string> = {
      fibromyalgie: '#ddd6fe',
      fibromyalgia: '#ddd6fe',
      endometriose: '#bfdbfe',
      endometriosis: '#bfdbfe',
      sdrc: '#a7f3d0',
      sfc_me: '#fed7aa',
    };
    return colors[pid.toLowerCase()] || '#e5e7eb';
  };

  const pathologyTextColor = (pid: string) => {
    const colors: Record<string, string> = {
      fibromyalgie: '#6d28d9',
      fibromyalgia: '#6d28d9',
      endometriose: '#1d4ed8',
      endometriosis: '#1d4ed8',
      sdrc: '#065f46',
      sfc_me: '#92400e',
    };
    return colors[pid.toLowerCase()] || '#374151';
  };

  return (
    <div className="page-content">
      {/* Header */}
      <div className="dash-page-header">
        <div>
          <h1 className="dash-greeting">
            Bonjour, {firstName} <span className="wave">👋</span>
          </h1>
          <p className="dash-subtitle">Voici un aperçu de votre activité et des diagnostics SCDP</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="stat-cards-grid">
        {statCards.map((sc) => (
          <div key={sc.label} className="stat-card-new">
            <div className="stat-card-top">
              <div>
                <div className="stat-card-icon" style={{ background: sc.iconBg, color: sc.iconColor }}>
                  {sc.icon}
                </div>
                <div className="stat-card-label">{sc.label}</div>
                <div className="stat-card-value">{sc.value}</div>
                <div className="stat-card-change">{sc.change}</div>
              </div>
              <div className="stat-card-spark">
                <Sparkline data={sc.sparkData} color={sc.sparkColor} width={80} height={40} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="charts-row">
        {/* Line chart */}
        <div className="card chart-card">
          <div className="card-header">
            <span className="card-title">Répartition par pathologie</span>
          </div>
          <div className="card-body chart-body">
            <AreaChart data={pathologyData.length > 0 ? pathologyData : [{ label: '—', value: 0 }]} />
          </div>
        </div>

        {/* Donut chart */}
        <div className="card chart-card donut-card">
          <div className="card-header">
            <span className="card-title">Statut des derniers diagnostics</span>
          </div>
          <div className="card-body donut-body">
            <DonutChartDark data={donutData} />
            <div className="donut-legend">
              {donutData.map((d) => (
                <div key={d.label} className="donut-legend-item">
                  <span className="donut-legend-dot" style={{ background: d.color }} />
                  <span className="donut-legend-label">{d.label}</span>
                  <span className="donut-legend-value">
                    {d.value} ({donutTotal > 0 ? Math.round((d.value / donutTotal) * 100) : 0}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Reports */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Derniers rapports</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Pathologie</th>
                <th>Score</th>
                <th>Probabilité</th>
                <th>Décision</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <FileText size={40} color="#d1d5db" />
                      <div className="empty-title">Aucun rapport</div>
                      <div className="empty-desc">Créez votre première évaluation SCDP</div>
                    </div>
                  </td>
                </tr>
              ) : (
                reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Calendar size={14} color="#9ca3af" />
                        <span style={{ fontSize: 13 }}>{formatDateTime(r.created_at)}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className="path-tag"
                        style={{
                          background: pathologyColor(r.pathology_id),
                          color: pathologyTextColor(r.pathology_id),
                        }}
                      >
                        {r.pathology_id}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: 700,
                          color:
                            r.score_final_normalized > 40 ? '#f59e0b' : '#ef4444',
                        }}
                      >
                        {r.score_final_normalized.toFixed(1)}
                      </span>
                      <span style={{ color: '#9ca3af', fontSize: 12 }}> /100</span>
                    </td>
                    <td style={{ color: '#374151' }}>{r.probability_pct.toFixed(1)}%</td>
                    <td>
                      <span
                        className={`decision-badge ${
                          r.decision_class === 'HAUTEMENT_PROBABLE'
                            ? 'decision-high'
                            : r.decision_class === 'PROBABLE'
                            ? 'decision-probable'
                            : 'decision-uncertain'
                        }`}
                      >
                        {r.decision_class.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {reports.length > 0 && (
          <div className="card-footer-center">
            <button className="btn btn-outline btn-sm">
              Voir tous les rapports <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCDP Evaluation Page
// ─────────────────────────────────────────────

function EvaluationPage(): JSX.Element {
  const { addToast } = useApp();
  const [pathologies, setPathologies] = useState<Pathology[]>([]);
  const [selectedPathology, setSelectedPathology] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [pathologyLoading, setPathologyLoading] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [errors, setErrors] = useState<ValidationError[]>([]);

  const [wpi, setWpi] = useState(7);
  const [fatigueScore, setFatigueScore] = useState(2);
  const [sleepScore, setSleepScore] = useState(2);
  const [cognitiveScore, setCognitiveScore] = useState(1);
  const [psychScore, setPsychScore] = useState(1);
  const [evolutionMonths, setEvolutionMonths] = useState(6);
  const [exclusionFlags, setExclusionFlags] = useState([false, false, false]);
  const [specificFields, setSpecificFields] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const fetchPathologies = async () => {
      try {
        const res = await api.getPathologies();
        setPathologies(res.pathologies);
        if (res.pathologies.length > 0) setSelectedPathology(res.pathologies[0].pathology_id);
      } catch {
        addToast({ type: 'error', title: 'Erreur lors du chargement des pathologies' });
      } finally {
        setPathologyLoading(false);
      }
    };
    fetchPathologies();
  }, [addToast]);

  useEffect(() => {
    const pathology = pathologies.find((p) => p.pathology_id === selectedPathology);
    if (pathology) {
      const defaults: Record<string, unknown> = {};
      pathology.specific_fields.forEach((f) => {
        if (f.type === 'boolean') defaults[f.name] = false;
        else if (f.type === 'integer') defaults[f.name] = f.range ? f.range[0] : 0;
        else if (f.type === 'date') defaults[f.name] = '';
      });
      setSpecificFields(defaults);
    }
    setReport(null);
    setErrors([]);
  }, [selectedPathology, pathologies]);

  const currentPathology = pathologies.find((p) => p.pathology_id === selectedPathology);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors([]);
    setReport(null);
    const clinicalData: ClinicalData = {
      WPI: wpi,
      fatigue_score: fatigueScore,
      sleep_score: sleepScore,
      cognitive_score: cognitiveScore,
      psych_score: psychScore,
      evolution_months: evolutionMonths,
      exclusion_flags: exclusionFlags,
      ...specificFields,
    };
    try {
      const result = await api.evaluate(selectedPathology, clinicalData);
      setReport(result);
      addToast({ type: 'success', title: 'Évaluation terminée', message: `Décision: ${result.decision_class}` });
    } catch (err) {
      const apiErr = err as ApiError;
      if (typeof apiErr.detail === 'object' && apiErr.detail.validation_errors) {
        setErrors(apiErr.detail.validation_errors);
      } else {
        addToast({ type: 'error', title: "Erreur lors de l'évaluation" });
      }
    } finally {
      setLoading(false);
    }
  };

  const updateSpecificField = (name: string, value: unknown) => {
    setSpecificFields((prev) => ({ ...prev, [name]: value }));
  };

  if (pathologyLoading) {
    return (
      <div className="page-content center-loader">
        <Loader2 size={40} className="spin-icon" color="#7c3aed" />
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Évaluation SCDP</h1>
        <p className="page-subtitle">Pipeline de classification diagnostique probabiliste (étapes a à g)</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: report ? '1fr 1fr' : '1fr', gap: 24 }}>
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="card-header">
              <span className="card-title">Données cliniques</span>
              <select
                className="input select-sm"
                value={selectedPathology}
                onChange={(e) => setSelectedPathology(e.target.value)}
              >
                {pathologies.map((p) => (
                  <option key={p.pathology_id} value={p.pathology_id}>
                    {p.pathology_label}
                  </option>
                ))}
              </select>
            </div>
            <div className="card-body">
              {errors.length > 0 && (
                <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {errors.map((e, i) => (
                    <div key={i} className="auth-error">
                      <AlertCircle size={14} /> {e.field}: {e.msg}
                    </div>
                  ))}
                </div>
              )}
              {currentPathology && (
                <div className="pathology-info-bar">
                  <span>{currentPathology.reference_standard} — Version {currentPathology.params_version}</span>
                  {currentPathology.ic_required && <span className="badge badge-info">Ic &gt; 1 requis</span>}
                </div>
              )}

              <div className="form-section">
                <div className="form-section-title">Scores cliniques communs</div>
                <div className="field-grid">
                  {[
                    { label: 'WPI (Widespread Pain Index)', val: wpi, set: setWpi, min: 0, max: 19 },
                    { label: 'Fatigue (F)', val: fatigueScore, set: setFatigueScore, min: 0, max: 3 },
                    { label: 'Sommeil (S)', val: sleepScore, set: setSleepScore, min: 0, max: 3 },
                    { label: 'Cognitif (C)', val: cognitiveScore, set: setCognitiveScore, min: 0, max: 3 },
                    { label: 'Psychologique (Psy)', val: psychScore, set: setPsychScore, min: 0, max: 3 },
                  ].map((f) => (
                    <div key={f.label} className="field-slider">
                      <div className="field-slider-header">
                        <label>{f.label}</label>
                        <span className="field-slider-value">{f.val}</span>
                      </div>
                      <input
                        type="range"
                        min={f.min}
                        max={f.max}
                        value={f.val}
                        onChange={(e) => f.set(parseInt(e.target.value))}
                      />
                      <div className="range-labels">
                        <span>{f.min}</span>
                        <span>{f.max}</span>
                      </div>
                    </div>
                  ))}
                  <div className="input-group">
                    <label>Durée d'évolution (mois)</label>
                    <input
                      type="number"
                      className="input"
                      min={0}
                      value={evolutionMonths}
                      onChange={(e) => setEvolutionMonths(parseInt(e.target.value) || 0)}
                    />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <div className="form-section-title">Biomarqueurs d'exclusion organique</div>
                <div className="exclusion-grid">
                  {['Pathologie organique explicative', 'Inflammation systémique', 'Autre cause identifiable'].map((label, i) => (
                    <div
                      key={i}
                      className={`exclusion-item ${exclusionFlags[i] ? 'active' : ''}`}
                      onClick={() => {
                        const n = [...exclusionFlags];
                        n[i] = !n[i];
                        setExclusionFlags(n);
                      }}
                    >
                      <input type="checkbox" checked={exclusionFlags[i]} onChange={() => {}} />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {currentPathology?.specific_fields && currentPathology.specific_fields.length > 0 && (
                <div className="form-section">
                  <div className="form-section-title">Champs spécifiques — {currentPathology.pathology_label}</div>
                  <div className="field-grid">
                    {currentPathology.specific_fields.map((field) => (
                      <div key={field.name} className="input-group">
                        <label>{field.label}</label>
                        {field.type === 'integer' && field.range && (
                          <>
                            <div className="field-slider-header" style={{ marginBottom: 4 }}>
                              <span />
                              <span className="field-slider-value">{specificFields[field.name] ?? field.range[0]}</span>
                            </div>
                            <input
                              type="range"
                              min={field.range[0]}
                              max={field.range[1]}
                              value={(specificFields[field.name] as number) ?? field.range[0]}
                              onChange={(e) => updateSpecificField(field.name, parseInt(e.target.value))}
                            />
                          </>
                        )}
                        {field.type === 'boolean' && (
                          <div
                            className={`exclusion-item ${specificFields[field.name] ? 'active' : ''}`}
                            onClick={() => updateSpecificField(field.name, !specificFields[field.name])}
                            style={{ marginTop: 8 }}
                          >
                            <input type="checkbox" checked={!!specificFields[field.name]} onChange={() => {}} />
                            <span>Oui</span>
                          </div>
                        )}
                        {field.type === 'date' && (
                          <input
                            type="date"
                            className="input"
                            value={(specificFields[field.name] as string) ?? ''}
                            onChange={(e) => updateSpecificField(field.name, e.target.value)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="card-footer">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? (
                  <><Loader2 size={16} className="spin-icon" /> Calcul en cours...</>
                ) : (
                  <><Zap size={16} /> Lancer l'évaluation SCDP</>
                )}
              </button>
            </div>
          </form>
        </div>

        {report && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Rapport d'évaluation</span>
              {report.report_id && (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => api.downloadReportPdf(report.report_id!).catch(() => addToast({ type: 'error', title: 'Erreur téléchargement PDF' }))}
                >
                  <Download size={14} /> PDF
                </button>
              )}
            </div>
            <div className="card-body">
              <ReportDisplay report={report} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportDisplay({ report }: { report: Report }): JSX.Element {
  const cls = report.decision_class;
  const isHigh = cls === 'HAUTEMENT_PROBABLE';
  const isMid = cls === 'PROBABLE';
  const decisionClass = isHigh ? 'decision-high' : isMid ? 'decision-probable' : 'decision-uncertain';

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <span className={`decision-badge ${decisionClass}`} style={{ fontSize: 14, padding: '8px 16px' }}>
          {cls.replace(/_/g, ' ')}
        </span>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
          {report.pathology_label || report.pathology_id}
        </div>
      </div>

      <div className="report-scores">
        <div className="metric-box">
          <div className="metric-box-label">Score final</div>
          <div className="metric-box-value">
            {report.score_final_normalized.toFixed(1)}
            <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400 }}> /100</span>
          </div>
        </div>
        <div className="metric-box">
          <div className="metric-box-label">Probabilité</div>
          <div className="metric-box-value">{report.probability_pct.toFixed(1)}%</div>
        </div>
        <div className="metric-box">
          <div className="metric-box-label">Ic</div>
          <div className="metric-box-value">
            {report.Ic.toFixed(3)}
            <div style={{ fontSize: 11, color: report.Ic > 1 ? '#10b981' : '#9ca3af', marginTop: 2 }}>
              {report.ic_signature?.replace(/_/g, ' ') || (report.Ic > 1 ? 'centrale' : 'périphérique')}
            </div>
          </div>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-title">Contraintes binaires</div>
        <div className="constraints-list">
          {report.constraints_detail.map((c) => (
            <div key={c.id} className="constraint-item">
              {c.satisfied ? (
                <CheckCircle size={18} color="#10b981" style={{ flexShrink: 0 }} />
              ) : (
                <X size={18} color="#ef4444" style={{ flexShrink: 0 }} />
              )}
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{c.label}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{c.clinical_reason}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-title">Données d'entrée</div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Champ</th>
                <th>Valeur</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(report.input_trace).map(([key, value]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>
                    {Array.isArray(value) ? `[${value.join(', ')}]` : String(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 16 }}>
        <div>Version: <code>{report.params_version_id}</code></div>
        {report.computed_at && <div>Calculé le: {formatDateTime(report.computed_at)}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Reports Page
// ─────────────────────────────────────────────

function ReportsPage(): JSX.Element {
  const { addToast, user } = useApp();
  const [reports, setReports] = useState<PaginatedReports | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pathologyFilter, setPathologyFilter] = useState('');
  const [pathologies, setPathologies] = useState<Pathology[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  useEffect(() => {
    api.getPathologies().then((r) => setPathologies(r.pathologies)).catch(() => {});
  }, []);

  useEffect(() => {
    const fetchReports = async () => {
      setLoading(true);
      try {
        const res = await api.getReports(page, 20, pathologyFilter || undefined);
        setReports(res);
      } catch {
        addToast({ type: 'error', title: 'Erreur lors du chargement des rapports' });
      } finally {
        setLoading(false);
      }
    };
    fetchReports();
  }, [page, pathologyFilter, addToast]);

  const handleViewReport = async (id: string) => {
    try {
      const report = await api.getReport(id);
      setSelectedReport(report);
    } catch {
      addToast({ type: 'error', title: 'Erreur lors du chargement du rapport' });
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Historique des rapports</h1>
        <p className="page-subtitle">{user?.role === 'admin' ? 'Tous les rapports du système' : "Vos rapports d'évaluation"}</p>
      </div>

      <div className="filter-bar">
        <select
          className="input select-sm"
          value={pathologyFilter}
          onChange={(e) => { setPathologyFilter(e.target.value); setPage(1); }}
        >
          <option value="">Toutes les pathologies</option>
          {pathologies.map((p) => (
            <option key={p.pathology_id} value={p.pathology_id}>{p.pathology_label}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="center-loader" style={{ padding: 48 }}>
              <Loader2 size={36} className="spin-icon" color="#7c3aed" />
            </div>
          ) : reports && reports.items.length > 0 ? (
            <table className="table table-clickable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Pathologie</th>
                  <th>Score</th>
                  <th>Probabilité</th>
                  <th>Décision</th>
                  <th>PDF</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {reports.items.map((r) => (
                  <tr key={r.id} onClick={() => handleViewReport(r.id)}>
                    <td style={{ fontSize: 13 }}>{formatDateTime(r.created_at)}</td>
                    <td>
                      <span className="path-tag" style={{ background: '#ede9fe', color: '#6d28d9' }}>{r.pathology_id}</span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700 }}>{r.score_final_normalized.toFixed(1)}</span>
                      <span style={{ color: '#9ca3af', fontSize: 12 }}> /100</span>
                    </td>
                    <td>{r.probability_pct.toFixed(1)}%</td>
                    <td>
                      <span className={`decision-badge ${r.decision_class === 'HAUTEMENT_PROBABLE' ? 'decision-high' : r.decision_class === 'PROBABLE' ? 'decision-probable' : 'decision-uncertain'}`}>
                        {r.decision_class.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      {r.pdf_available && (
                        <button
                          className="btn btn-ghost btn-icon-sm"
                          onClick={(e) => { e.stopPropagation(); api.downloadReportPdf(r.id).catch(() => addToast({ type: 'error', title: 'Erreur PDF' })); }}
                        >
                          <Download size={15} />
                        </button>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-icon-sm">
                        <Eye size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <FileText size={40} color="#d1d5db" />
              <div className="empty-title">Aucun rapport trouvé</div>
              <div className="empty-desc">Créez une nouvelle évaluation SCDP</div>
            </div>
          )}
        </div>

        {reports && reports.total_pages > 1 && (
          <div className="pagination">
            <span className="pagination-info">{reports.total} rapport{reports.total > 1 ? 's' : ''}</span>
            <button className="btn btn-ghost btn-icon-sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 13 }}>Page {page} / {reports.total_pages}</span>
            <button className="btn btn-ghost btn-icon-sm" disabled={page === reports.total_pages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {selectedReport && (
        <div className="modal-overlay" onClick={() => setSelectedReport(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Détail du rapport</span>
              <button className="btn btn-ghost btn-icon-sm" onClick={() => setSelectedReport(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <ReportDisplay report={selectedReport} />
            </div>
            <div className="modal-footer">
              {selectedReport.report_id && selectedReport.pdf_available && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => api.downloadReportPdf(selectedReport.report_id!).catch(() => addToast({ type: 'error', title: 'Erreur PDF' }))}
                >
                  <Download size={14} /> PDF
                </button>
              )}
              <button className="btn btn-outline btn-sm" onClick={() => setSelectedReport(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Pathologies Page
// ─────────────────────────────────────────────

function PathologiesPage(): JSX.Element {
  const { addToast, user } = useApp();
  const [pathologies, setPathologies] = useState<Pathology[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedParams, setSelectedParams] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api.getPathologies()
      .then((r) => setPathologies(r.pathologies))
      .catch(() => addToast({ type: 'error', title: 'Erreur chargement pathologies' }))
      .finally(() => setLoading(false));
  }, [addToast]);

  const handleViewParams = async (pid: string) => {
    if (user?.role !== 'admin') {
      addToast({ type: 'error', title: 'Accès réservé aux administrateurs' });
      return;
    }
    try {
      const params = await api.getPathologyParams(pid);
      setSelectedParams(params);
    } catch {
      addToast({ type: 'error', title: 'Erreur chargement paramètres' });
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Pathologies disponibles</h1>
        <p className="page-subtitle">Configurations pathologie-spécifiques du moteur SCDP</p>
      </div>

      {loading ? (
        <div className="center-loader" style={{ paddingTop: 48 }}>
          <Loader2 size={40} className="spin-icon" color="#7c3aed" />
        </div>
      ) : (
        <div className="path-cards-grid">
          {pathologies.map((p) => (
            <div key={p.pathology_id} className="card path-card" onClick={() => handleViewParams(p.pathology_id)}>
              <div className="card-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{p.pathology_label}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Version {p.params_version}</div>
                  </div>
                  {p.ic_required && <span className="badge badge-violet">Ic requis</span>}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>{p.reference_standard}</div>
                {p.specific_fields.length > 0 && (
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>
                    +{p.specific_fields.length} champ{p.specific_fields.length > 1 ? 's' : ''} spécifique{p.specific_fields.length > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedParams && (
        <div className="modal-overlay" onClick={() => setSelectedParams(null)}>
          <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Paramètres de la pathologie</span>
              <button className="btn btn-ghost btn-icon-sm" onClick={() => setSelectedParams(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <pre className="json-pre">{JSON.stringify(selectedParams, null, 2)}</pre>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline btn-sm" onClick={() => setSelectedParams(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Monitoring Page
// ─────────────────────────────────────────────

function MonitoringPage(): JSX.Element {
  const { addToast } = useApp();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [metrics, setMetrics] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [healthRes, metricsRes] = await Promise.all([api.getHealth(), api.getMetrics()]);
      setHealth(healthRes);
      setMetrics(metricsRes);
    } catch {
      addToast({ type: 'error', title: 'Erreur métriques' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="page-content center-loader"><Loader2 size={40} className="spin-icon" color="#7c3aed" /></div>;

  return (
    <div className="page-content">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="page-title">Monitoring système</h1>
          <p className="page-subtitle">Statut et métriques Prometheus</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => { setRefreshing(true); fetchData(); }} disabled={refreshing}>
          {refreshing ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />} Rafraîchir
        </button>
      </div>

      {health && (
        <div className="stat-cards-grid" style={{ marginBottom: 24 }}>
          {[
            { label: 'Statut', value: <span className={`decision-badge ${health.status === 'ok' ? 'decision-high' : 'decision-probable'}`}>{health.status.toUpperCase()}</span>, icon: <Activity size={18} />, iconColor: '#10b981', iconBg: '#ecfdf5' },
            { label: 'Uptime', value: formatDuration(health.uptime_seconds), icon: <Clock size={18} />, iconColor: '#7c3aed', iconBg: '#f5f3ff' },
            { label: 'Base de données', value: <span className={`decision-badge ${health.database === 'ok' ? 'decision-high' : 'decision-uncertain'}`}>{health.database.toUpperCase()}</span>, icon: <Database size={18} />, iconColor: '#0ea5e9', iconBg: '#f0f9ff' },
            { label: 'Pathologies chargées', value: health.pathologies_loaded, icon: <FlaskConical size={18} />, iconColor: '#f59e0b', iconBg: '#fffbeb' },
          ].map((sc) => (
            <div key={sc.label} className="stat-card-new">
              <div className="stat-card-top">
                <div>
                  <div className="stat-card-icon" style={{ background: sc.iconBg, color: sc.iconColor }}>{sc.icon}</div>
                  <div className="stat-card-label">{sc.label}</div>
                  <div className="stat-card-value">{sc.value}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-header"><span className="card-title">Métriques Prometheus</span></div>
        <div className="card-body">
          <pre className="json-pre" style={{ maxHeight: 500 }}>{metrics || 'Aucune métrique disponible'}</pre>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Audit Logs Page
// ─────────────────────────────────────────────

function AuditLogsPage(): JSX.Element {
  const { addToast } = useApp();
  const [logs, setLogs] = useState<PaginatedAuditLogs | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      try {
        const res = await api.getAuditLogs(page, 50, undefined, actionFilter || undefined);
        setLogs(res);
      } catch {
        addToast({ type: 'error', title: 'Erreur chargement logs' });
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, [page, actionFilter, addToast]);

  const getActionClass = (action: string) => {
    if (action.includes('error') || action.includes('failed')) return 'decision-uncertain';
    if (action.includes('success') || action.includes('register')) return 'decision-high';
    if (action.includes('login')) return 'decision-probable';
    return 'badge-neutral-plain';
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Audit logs</h1>
        <p className="page-subtitle">Journal des actions système</p>
      </div>
      <div className="filter-bar">
        <input
          type="text"
          className="input select-sm"
          placeholder="Filtrer par action..."
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
        />
      </div>
      <div className="card">
        <div className="table-wrap">
          {loading ? (
            <div className="center-loader" style={{ padding: 48 }}><Loader2 size={36} className="spin-icon" color="#7c3aed" /></div>
          ) : logs && logs.items.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Acteur</th>
                  <th>IP</th>
                  <th>Payload</th>
                </tr>
              </thead>
              <tbody>
                {logs.items.map((log) => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{formatDateTime(log.created_at)}</td>
                    <td><span className={`decision-badge ${getActionClass(log.action)}`}>{log.action}</span></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{log.actor_id ? log.actor_id.substring(0, 8) + '...' : 'Système'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{log.ip_address || '-'}</td>
                    <td>
                      {log.payload && (
                        <button
                          className="btn btn-ghost btn-icon-sm"
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(log.payload, null, 2));
                            addToast({ type: 'info', title: 'Copié' });
                          }}
                        >
                          <Copy size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <List size={40} color="#d1d5db" />
              <div className="empty-title">Aucun log trouvé</div>
            </div>
          )}
        </div>
        {logs && logs.total_pages > 1 && (
          <div className="pagination">
            <span className="pagination-info">{logs.total} entrée{logs.total > 1 ? 's' : ''}</span>
            <button className="btn btn-ghost btn-icon-sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={16} /></button>
            <span style={{ fontSize: 13 }}>Page {page} / {logs.total_pages}</span>
            <button className="btn btn-ghost btn-icon-sm" disabled={page === logs.total_pages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Profile Page
// ─────────────────────────────────────────────

function ProfilePage(): JSX.Element {
  const { user } = useApp();
  const handleLogout = () => { api.clearTokens(); window.location.reload(); };

  return (
    <div className="page-content" style={{ maxWidth: 600 }}>
      <div className="page-header">
        <h1 className="page-title">Mon profil</h1>
        <p className="page-subtitle">Informations du compte</p>
      </div>
      <div className="card">
        <div className="card-header"><span className="card-title">Informations</span></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { icon: <Mail size={16} />, label: 'Email', value: user?.email },
            { icon: <Shield size={16} />, label: 'Rôle', value: <span className={`decision-badge ${user?.role === 'admin' ? 'decision-probable' : 'decision-high'}`}>{user?.role === 'admin' ? 'Administrateur' : 'Médecin'}</span> },
            { icon: <Calendar size={16} />, label: 'Compte créé le', value: user?.created_at ? formatDate(user.created_at) : '-' },
          ].map((row) => (
            <div key={row.label} className="profile-row">
              <div className="profile-row-label">{row.icon} {row.label}</div>
              <div className="profile-row-value">{row.value}</div>
            </div>
          ))}
        </div>
        <div className="card-footer">
          <button className="btn btn-danger btn-sm" onClick={handleLogout}>
            <LogOut size={14} /> Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────

function Layout({ children, onNavigate, currentPage }: { children: React.ReactNode; onNavigate: (page: string) => void; currentPage: string }): JSX.Element {
  const { user, theme, toggleTheme } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const handleNavigate = (page: string) => {
    onNavigate(page);
    setSidebarOpen(false);
  };

  const handleLogout = () => { api.clearTokens(); window.location.reload(); };

  const navItems = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'evaluation', label: 'Évaluation SCDP', icon: FlaskConical },
    { id: 'reports', label: 'Rapports', icon: FileText },
    { id: 'pathologies', label: 'Pathologies', icon: Heart },
  ];

  const adminNavItems = [
    { id: 'monitoring', label: 'Monitoring', icon: Activity },
    { id: 'audit', label: 'Audit logs', icon: List },
  ];

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
<div className="sidebar-logo">
            <div className="sidebar-logo-icon">
              <img src="https://i.ibb.co/VYwpXLvQ/Capture-d-cran-2026-07-01-051916.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <div className="sidebar-logo-text">
              SCDP
              <span>Diagnostic Probabiliste</span>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-title">Navigation</div>
            {navItems.map((item) => (
              <div
                key={item.id}
                className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => handleNavigate(item.id)}
              >
                <item.icon size={18} />
                {item.label}
              </div>
            ))}
          </div>

          {user?.role === 'admin' && (
            <div className="nav-section">
              <div className="nav-section-title">Administration</div>
              {adminNavItems.map((item) => (
                <div
                  key={item.id}
                  className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                  onClick={() => handleNavigate(item.id)}
                >
                  <item.icon size={18} />
                  {item.label}
                </div>
              ))}
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div
            className={`sidebar-user ${currentPage === 'profile' ? 'active' : ''}`}
            onClick={() => handleNavigate('profile')}
          >
            <div className="sidebar-user-avatar">
              {user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.email?.split('@')[0]}</div>
              <div className="sidebar-user-role">{user?.role === 'admin' ? 'Admin' : 'Médecin'}</div>
            </div>
            <ChevronRight size={14} color="#9ca3af" />
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="btn btn-ghost btn-icon-sm mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <Menu size={20} />
            </button>
            <div className="topbar-search">
              <Search size={15} color="#9ca3af" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              />
            </div>
          </div>

          <div className="topbar-right">
            <button className="btn btn-ghost btn-icon-sm" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="btn btn-ghost btn-icon-sm notif-btn">
              <Bell size={18} />
            </button>

            <div className="user-dropdown">
              <div className="user-trigger" onClick={() => setDropdownOpen(!dropdownOpen)}>
                <div className="user-avatar">
                  {user?.email?.charAt(0).toUpperCase() || 'U'}
                </div>
              </div>

              {dropdownOpen && (
                <div className="user-dropdown-menu">
                  <div className="user-dropdown-info">
                    <div className="user-dropdown-name">{user?.email?.split('@')[0]}</div>
                    <div className="user-dropdown-email">{user?.email}</div>
                  </div>
                  <div className="user-dropdown-sep" />
                  <div className="user-dropdown-item" onClick={() => { handleNavigate('profile'); setDropdownOpen(false); }}>
                    <User size={15} /> Profil
                  </div>
                  <div className="user-dropdown-item danger" onClick={handleLogout}>
                    <LogOut size={15} /> Déconnexion
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {children}
      </main>

      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────

function App(): JSX.Element {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('scdp_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('scdp_theme') as 'dark' | 'light') || 'light'
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [showLanding, setShowLanding] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('scdp_theme', theme);
  }, [theme]);

  useEffect(() => {
    if (user && !api.isAuthenticated()) {
      setUser(null);
      localStorage.removeItem('scdp_user');
    }
  }, [user]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const addToast = (toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => removeToast(id), 5000);
  };

  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const isAuthenticated = api.isAuthenticated() && user;

  const ctxValue = { user, setUser, theme, toggleTheme, toasts, addToast, removeToast, isLoading, setIsLoading };

  if (showLanding && !isAuthenticated) {
    return (
      <AppContext.Provider value={ctxValue}>
        <LandingPage onEnter={() => setShowLanding(false)} />
        <ToastContainer />
      </AppContext.Provider>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppContext.Provider value={ctxValue}>
        <AuthPage />
        <ToastContainer />
      </AppContext.Provider>
    );
  }

  const renderPage = (): JSX.Element => {
    switch (currentPage) {
      case 'dashboard': return <DashboardPage />;
      case 'evaluation': return <EvaluationPage />;
      case 'reports': return <ReportsPage />;
      case 'pathologies': return <PathologiesPage />;
      case 'monitoring': return user?.role === 'admin' ? <MonitoringPage /> : <DashboardPage />;
      case 'audit': return user?.role === 'admin' ? <AuditLogsPage /> : <DashboardPage />;
      case 'profile': return <ProfilePage />;
      default: return <DashboardPage />;
    }
  };

  return (
    <AppContext.Provider value={ctxValue}>
      <Layout onNavigate={setCurrentPage} currentPage={currentPage}>
        {renderPage()}
      </Layout>
      <ToastContainer />
    </AppContext.Provider>
  );
}

export default App;
