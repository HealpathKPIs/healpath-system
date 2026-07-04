'use client';
import { useState } from 'react';

export default function Login() {
  const [pw, setPw] = useState('');
  return (
    <div className="loginwrap">
      <div className="loginbox">
        <div className="brand" style={{ padding: 0, marginBottom: 8 }}>Heal<span>Path</span></div>
        <p className="muted">Executive BI dashboard - shared access</p>
        <input type="password" placeholder="Dashboard password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button onClick={() => { document.cookie = 'hp_auth=1; path=/'; location.href = '/'; }}>Sign in</button>
      </div>
    </div>
  );
}
