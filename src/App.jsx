import React, { useEffect, useRef, useState } from "react";
import Header from "./components/Header";
import EmailList from "./components/EmailList";
import EmailView from "./components/EmailView";
import { randomDomain, randomString, domains, initWebSocket } from "./utils/api";
import { Check, Copy, History, RefreshCcw, Shuffle } from "lucide-react";
import HistoryModal from "./components/History";
import { ToastProvider } from "./contexts/ToastContext";
import useTheme from "./utils/useTheme";
/* global browser */
if (typeof browser === "undefined") {
  /* global chrome */
  var browser = chrome;
}
function App() {
  const [loading, setLoading] = useState(false);
  const [domainsList, setDomainsList] = useState(["junkstopper.info", "areueally.info"]);
  const [email, setEmail] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [trigger, setTrigger] = useState(0)
  const eListRef = useRef(null);
  useTheme(trigger)

  const handleOpenHistory = () => {
    setShowHistory(true);
  }

  const handleRefresh = () => {
    if (eListRef.current) {
      eListRef.current.refresh();
    }
  }

  useEffect(() => {
    // Fetch domains first
    fetch("https://api2.freecustom.email/domains")
      .then(r => r.json())
      .then(d => {
         if (d.success && d.data && d.data.length > 0) {
            const doms = d.data.map(x => x.domain);
            setDomainsList(doms);
         }
      })
      .catch(e => console.error("Failed to fetch domains", e))
      .finally(() => {
        if (typeof browser !== 'undefined' && browser.storage) {
          browser.storage.local.get("tempEmail").then(res => {
            const cachedEmail = res.tempEmail;
            if (cachedEmail) {
              setEmail(cachedEmail);
              setSelectedDomain(cachedEmail.split("@")[1]);
            }
          });
        }
      });
  }, []);

  // Set initial email if not cached, once domains are loaded
  useEffect(() => {
    if (domainsList.length > 0 && !email) {
      if (typeof browser !== 'undefined' && browser.storage) {
        browser.storage.local.get("tempEmail").then(res => {
          if (!res.tempEmail) {
            const rdom = domainsList[Math.floor(Math.random() * domainsList.length)];
            const newEmail = randomString(10) + "@" + rdom;
            setEmail(newEmail);
            setSelectedDomain(rdom);
            browser.storage.local.set({ tempEmail: newEmail });
            initWebSocket(newEmail);
          }
        });
      }
    }
  }, [domainsList, email]);



  const handleRandomEmail = () => {
    const rdom = domainsList[Math.floor(Math.random() * domainsList.length)];
    const newEmail = randomString(10) + "@" + rdom;
    setEmail(newEmail);
    setSelectedDomain(rdom);
    browser.storage.local.set({ tempEmail: newEmail });
    initWebSocket(newEmail);
    if (eListRef.current) {
      eListRef.current.clientRefresh(email)
    }
  };

  return (
    <div className="p-4 font-sans w-[400px] h-[550px] bg-bg text-fg">
      <ToastProvider>
        <Header setTrigger={(d) => setTrigger(d)} mailbox={email} onSelectEmail={setSelectedEmail} />
        <div className="flex flex-row justify-between space-x-1 items-center">
          <div className="flex flex-row items-center w-full">
            <input
              id="email"
              type="text"
              value={email.split("@")[0]}
              onChange={(e) => {
                const localPart = e.target.value.replace(/[^a-z0-9]/gi, "").toLowerCase();
                const newEmail = localPart + "@" + selectedDomain;
                setEmail(newEmail);
                browser.storage.local.set({ tempEmail: newEmail });
                initWebSocket(newEmail);
                if (eListRef.current) {
                  eListRef.current.clientRefresh(email)
                }
              }}
              className="outline-none focus:outline-none focus:ring-0 p-1.5 w-full border border-bbg rounded-tl-md rounded-bl-md bg-bg text-fg"
            />
            <select
              value={selectedDomain}
              onChange={(e) => {
                const newEmail = email.split("@")[0] + "@" + e.target.value;
                setSelectedDomain(e.target.value);
                setEmail(newEmail);
                browser.storage.local.set({ tempEmail: newEmail });
                initWebSocket(newEmail);
                if (eListRef.current) {
                  eListRef.current.clientRefresh(newEmail)
                }
              }}
              className="border py-1.5 w-full border-bbg rounded-tr-md rounded-br-md border-l-0 bg-bg text-fg"
            >
              {domainsList.map((domain) => (
                <option key={domain} value={domain}>
                  @{domain}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(email);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch (err) {
                console.error("Failed to copy: ", err);
              }
            }}
            className="text-sm py-2 px-2 rounded-md border border-bbg"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>

        <div className="my-4 flex flex-row justify-center items-center space-x-1">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="text-sm py-0.5 px-1.5 rounded-md border border-bbg flex flex-row items-center"
          >
            <RefreshCcw className={`${loading ? "animate-spin" : ""} mr-1 inline`} size={16} /> Refresh
          </button>
          <button
            onClick={handleRandomEmail}
            disabled={loading}
            className="text-sm py-0.5 px-1.5 rounded-md border border-bbg flex flex-row items-center"
          >
            <Shuffle className="mr-1 inline" size={16} /> Random
          </button>
          <button
            onClick={handleOpenHistory}
            disabled={loading}
            className="text-sm py-0.5 px-1.5 rounded-md border border-bbg flex flex-row items-center"
          >
            <History className="mr-1 inline" size={16} /> History
          </button>
        </div>

        <EmailList mailbox={email} onSelectEmail={setSelectedEmail} setLoading={setLoading} ref={eListRef} />

        <EmailView email={selectedEmail} onClose={() => setSelectedEmail(null)} />

        {showHistory && <HistoryModal isOpen={showHistory} onClose={() => setShowHistory(false)} usingEmail={(e) => {
          setEmail(e)
          setSelectedDomain(e.split('@')[1])
          browser.storage.local.set({ tempEmail: e });
          if (eListRef.current) {
            eListRef.current.clientRefresh(email)
          }
        }} />}
      </ToastProvider>
    </div>
  );
}

export default App;
