import { Component, ErrorInfo, ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; errorId: string; }

const IS_DEV = import.meta.env.DEV;

function genId(): string {
  return Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).substring(2, 6).toUpperCase();
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorId: "" };

  static getDerivedStateFromError(error: Error): State {
    return { error, errorId: genId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // في development فقط — لا نُرسل للخارج
    if (IS_DEV) {
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
  }

  render() {
    const { error, errorId } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        dir="rtl"
        className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6"
      >
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-lg p-8 text-center space-y-5">
          {/* Icon */}
          <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center mx-auto">
            <span className="text-3xl">⚠️</span>
          </div>

          {/* Title */}
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-1">
              حدث خطأ غير متوقع
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              نأسف لهذا الإزعاج. يمكنك المحاولة مجدداً.
            </p>
          </div>

          {/* Error ID — للدعم الفني */}
          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="text-right">
              <p className="text-xs text-slate-400">رمز الخطأ</p>
              <p className="font-mono text-sm font-bold text-slate-700 dark:text-slate-300">
                {errorId}
              </p>
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(errorId).catch(() => {});
              }}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-700 transition-all"
            >
              نسخ
            </button>
          </div>

          {/* Stack trace — فقط في development */}
          {IS_DEV && error.stack && (
            <details className="text-right">
              <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                تفاصيل الخطأ (وضع التطوير فقط)
              </summary>
              <pre className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-xl p-3 overflow-auto max-h-40 text-left">
                {error.stack}
              </pre>
            </details>
          )}

          {/* Action */}
          <button
            onClick={() => {
              this.setState({ error: null, errorId: "" });
              window.location.reload();
            }}
            className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-all"
          >
            إعادة تحميل التطبيق
          </button>
        </div>
      </div>
    );
  }
}
