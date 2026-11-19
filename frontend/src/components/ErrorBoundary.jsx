import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("NetGuard render error", error, info?.componentStack || "");
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-screen" dir="rtl">
          <div className="fatal-mark">NG</div>
          <span className="eyebrow">NETGUARD · خطای رابط کاربری</span>
          <h1>داشبورد نتوانست اجرا شود</h1>
          <p>خطایی در نمایش صفحه رخ داده است. داده‌های پایش دست‌نخورده‌اند؛ صفحه را دوباره بارگذاری کن.</p>
          <button type="button" onClick={() => window.location.reload()}>بارگذاری دوباره</button>
          <details><summary>جزئیات فنی</summary><pre>{String(this.state.error?.message || this.state.error)}</pre></details>
        </main>
      );
    }
    return this.props.children;
  }
}
