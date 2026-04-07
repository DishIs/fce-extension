import React, { useState, useEffect } from 'react';
import Setting from './Settings'
import Search from './Search'

/* global browser */
if (typeof browser === "undefined") {
  /* global chrome */
  var browser = chrome;
}

const Header = ({ setTrigger, mailbox, onSelectEmail }) => {
  const [extToken, setExtToken] = useState(null);

  useEffect(() => {
    if (typeof browser !== 'undefined' && browser.storage) {
      browser.storage.local.get("extToken").then(res => {
        if (res.extToken) setExtToken(res.extToken);
      });
    }
  }, []);

  const handleLogin = () => {
    window.open("https://www.freecustom.email/ext-auth", "_blank");
  };

  return (
    <header className="mb-2 p-2 bg-bg text-fg rounded flex flex-col">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-logo flex items-center ">
          FreeCustom.Email
        </h1>
        <div className='flex space-x-2 items-center'>
          {!extToken ? (
             <button onClick={handleLogin} className="text-xs bg-logo text-white px-2 py-1 rounded">Login</button>
          ) : (
             <span className="text-xs text-green-500 font-bold px-1" title="Connected">Pro</span>
          )}
          <Search onSelectEmail={onSelectEmail} mailbox={mailbox} />
          <Setting setTrigger={setTrigger} />
        </div>
      </div>
    </header>
  )
}

export default Header