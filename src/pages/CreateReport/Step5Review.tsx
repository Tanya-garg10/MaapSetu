import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { FileText, Download, CheckCircle2, AlertCircle, Scale, Sparkles, Loader2, XCircle } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function Step5Review() {
  const { currentReportId, setCurrentReportId, reportData, testResults } = useAppStore();
  const [instrument, setInstrument] = useState<any>(null);
  const [overallResult, setOverallResult] = useState<string | null>(null);
  const [failedTests, setFailedTests] = useState<string[]>([]);
  const [aiAdvice, setAiAdvice] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (reportData.instrumentId) {
      const id = typeof reportData.instrumentId === 'string'
        ? reportData.instrumentId : reportData.instrumentId._id;
      if (id) fetch(`/api/instruments/${id}`).then(r => r.json()).then(setInstrument);
    }
  }, [reportData.instrumentId]);

  // Helper to resolve a valid report ID from store, URL, or reportData
  const getResolvedReportId = (): string | undefined => {
    let id = currentReportId;
    if (id === 'undefined' || id === 'null') id = null;
    if (!id) {
      const params = new URLSearchParams(window.location.search);
      const paramId = params.get('id');
      if (paramId && paramId !== 'undefined' && paramId !== 'null') {
        id = paramId;
      }
    }
    if (!id && reportData) {
      const repId = reportData._id || reportData.id;
      if (repId && repId !== 'undefined' && repId !== 'null') {
        id = repId as string;
      }
    }
    return id || undefined;
  };

  // Auto-save a draft if report is not saved yet
  const ensureReportSaved = async (): Promise<string | null> => {
    const existingId = getResolvedReportId();
    if (existingId) return existingId;

    try {
      const data = useAppStore.getState().reportData;
      const appNo = data.applicationNo || `NAWI-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          applicationNo: appNo,
          status: 'Draft',
        }),
      });
      const newReport = await res.json();
      const newId = newReport._id || newReport.id;
      if (newId) {
        setCurrentReportId(newId);
        const params = new URLSearchParams(window.location.search);
        params.set('id', newId);
        window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
        return newId;
      }
    } catch (e) {
      console.error('Failed to auto-create report draft:', e);
    }
    return null;
  };

  const handleExportPDF = async () => {
    setPdfLoading(true);
    try {
      const id = await ensureReportSaved();
      if (!id) {
        alert('Could not save draft report. Please enter basic details in Step 1 first.');
        return;
      }
      const res = await fetch(`/api/reports/${id}/pdf`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `NAWI-Report-${reportData.applicationNo || id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed. Check the console for details.');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleFinalize = async () => {
    setFinalizing(true);
    try {
      const id = await ensureReportSaved();
      if (!id) {
        alert('Could not save draft report. Please enter basic details in Step 1 first.');
        return;
      }
      const res = await fetch(`/api/reports/${id}/finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      setOverallResult(data.overallResult);
      setFailedTests(data.failedTests || []);
    } catch (err) {
      console.error('Finalize error:', err);
    } finally { setFinalizing(false); }
  };

  const handleAIAdvice = async () => {
    if (!failedTests.length) return;
    setAiLoading(true);
    setAiAdvice('');
    try {
      const res = await fetch('/api/ai/compliance-advice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          failedTests,
          instrumentClass: instrument?.accuracyClass || 'III',
          oimlVersion: reportData.oimlVersion || 'OIML R 76-1:2006',
        }),
      });
      const d = await res.json();
      setAiAdvice(d.advice || '');
    } finally { setAiLoading(false); }
  };

  const validationItems = [
    { label: 'General Information', done: !!reportData.applicationNo },
    { label: 'Instrument Selected', done: !!reportData.instrumentId },
    { label: 'Lab Conditions', done: !!reportData.testConditions?.temperature },
    { label: `Test Records (${testResults.length})`, done: testResults.length > 0 },
  ];

  const overallColor = overallResult === 'Pass' ? 'emerald' : overallResult === 'Fail' ? 'red' : 'signal-orange';

  return (
    <div className="max-w-screen-2xl mx-auto px-5 py-8 lg:px-10 page-enter">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="info" dot>Step 5 of 5</Badge>
            {overallResult && (
              <Badge variant={overallResult === 'Pass' ? 'success' : overallResult === 'Fail' ? 'error' : 'warning'} dot>
                {overallResult}
              </Badge>
            )}
          </div>
          <h2 className="text-2xl font-heading font-bold text-near-black tracking-tight">Review & Finalize</h2>
          <p className="text-sm text-near-black/50 mt-1">Confirm all data, determine overall compliance, and generate the report.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handleExportPDF} disabled={pdfLoading}>
            {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export PDF
          </Button>
          <Button onClick={handleFinalize} disabled={!getResolvedReportId() || finalizing}>
            {finalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Determine Compliance
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left sidebar ──────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Checklist */}
          <div className="glass-surface rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-near-black/8 bg-near-black/3">
              <p className="text-xs font-semibold text-near-black/50 uppercase tracking-wider">Checklist</p>
            </div>
            <div className="divide-y divide-near-black/6">
              {validationItems.map(item => (
                <div key={item.label} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-near-black/65">{item.label}</span>
                  {item.done
                    ? <CheckCircle2 className="h-4 w-4 text-emerald shrink-0" />
                    : <AlertCircle className="h-4 w-4 text-signal-orange shrink-0" />
                  }
                </div>
              ))}
            </div>
          </div>

          {/* Test Results */}
          <div className="glass-surface rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-near-black/8 bg-near-black/3">
              <p className="text-xs font-semibold text-near-black/50 uppercase tracking-wider">Test Results</p>
            </div>
            <div className="divide-y divide-near-black/6">
              {testResults.length === 0 ? (
                <div className="px-5 py-6 text-center text-xs text-near-black/30">No tests completed</div>
              ) : testResults.map((t: any) => (
                <div key={t.testName} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-near-black">{t.testName}</p>
                    {t.testCode && <p className="text-xs font-mono text-near-black/30">{t.testCode}</p>}
                  </div>
                  <Badge variant={t.passed ? 'success' : 'error'} dot>
                    {t.passed ? 'Pass' : 'Fail'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Overall result box */}
          {overallResult && (
            <div className={cn(
              'rounded-2xl p-5 text-center border-2',
              overallResult === 'Pass' ? 'bg-emerald/8 border-emerald/30' :
                overallResult === 'Fail' ? 'bg-red/8 border-red/30' :
                  'bg-signal-orange/8 border-signal-orange/30'
            )}>
              {overallResult === 'Pass'
                ? <CheckCircle2 className="h-8 w-8 text-emerald mx-auto mb-2" />
                : <XCircle className="h-8 w-8 text-red mx-auto mb-2" />
              }
              <p className={cn(
                'text-xl font-heading font-bold',
                overallResult === 'Pass' ? 'text-emerald' : overallResult === 'Fail' ? 'text-red' : 'text-signal-orange'
              )}>
                Overall: {overallResult}
              </p>
              {failedTests.length > 0 && (
                <p className="text-xs text-near-black/50 mt-2">
                  Failed: {failedTests.join(', ')}
                </p>
              )}
            </div>
          )}

          {/* AI Compliance Advice */}
          {overallResult === 'Fail' && failedTests.length > 0 && (
            <div className="glass-surface rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-industrial-blue" />
                <p className="text-sm font-semibold text-near-black">AI Compliance Advice</p>
              </div>
              {aiAdvice ? (
                <p className="text-xs text-near-black/65 leading-relaxed">{aiAdvice}</p>
              ) : (
                <Button variant="subtle" size="sm" onClick={handleAIAdvice} disabled={aiLoading} className="w-full">
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Get AI Recommendations
                </Button>
              )}
            </div>
          )}
        </div>

        {/* ── A4 Document Preview ──────────────────────────────────── */}
        <div className="lg:col-span-2 glass-surface rounded-2xl p-4 overflow-auto flex justify-center">
          <div className="w-full max-w-[660px] bg-white rounded-xl shadow-[0_8px_32px_rgba(16,18,20,0.1)] font-sans text-near-black relative overflow-hidden">
            {/* Watermark */}
            <div className="absolute inset-0 flex items-center justify-center opacity-[0.025] pointer-events-none rotate-[-30deg]">
              <span className="text-7xl font-heading font-black">MAAPSETU</span>
            </div>

            {/* Header */}
            <div className="bg-[#123B5D] px-10 py-6 text-warm-ivory">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-base font-heading font-bold uppercase tracking-widest">NAWI Test Report</h1>
                  <p className="text-xs text-warm-ivory/50 mt-0.5 uppercase tracking-wider">OIML R 76-1 · Non-Automatic Weighing Instruments</p>
                </div>
                <div className="h-9 w-9 bg-white/10 rounded-xl flex items-center justify-center">
                  <Scale className="h-5 w-5 text-[#C7F36B]" />
                </div>
              </div>
            </div>

            <div className="px-10 py-6">
              {/* Metadata */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-4 mb-6 pb-6 border-b border-near-black/8">
                {[
                  { label: 'Application No.', value: reportData.applicationNo || 'DRAFT' },
                  { label: 'Date of Test', value: reportData.date?.split('T')[0] || new Date().toISOString().split('T')[0] },
                  { label: 'Lead Inspector', value: reportData.inspector || '—' },
                  { label: 'Purpose', value: reportData.purposeOfTest || 'Model Approval' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[10px] font-semibold text-near-black/35 uppercase tracking-wider">{label}</p>
                    <p className="text-sm font-semibold text-near-black mt-0.5">{value}</p>
                  </div>
                ))}
              </div>

              {/* Instrument */}
              <div className="mb-6 pb-6 border-b border-near-black/8">
                <p className="text-[10px] font-semibold text-near-black/35 uppercase tracking-wider mb-3">Instrument Details</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    { label: 'Manufacturer', value: instrument?.manufacturer || '—' },
                    { label: 'Model', value: instrument?.model || '—' },
                    { label: 'Serial No.', value: instrument?.serialNumber || '—' },
                    { label: 'Accuracy Class', value: instrument?.accuracyClass ? `Class ${instrument.accuracyClass}` : '—' },
                    { label: 'Max Capacity', value: instrument?.maxCapacity ? `${instrument.maxCapacity} kg` : '—' },
                    { label: 'Scale e', value: instrument?.eValue ? `${instrument.eValue} g` : '—' },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-[10px] text-near-black/30 uppercase tracking-wider">{label}</p>
                      <p className="text-xs font-semibold text-near-black mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Environmental */}
              {reportData.testConditions?.temperature && (
                <div className="mb-6 pb-6 border-b border-near-black/8">
                  <p className="text-[10px] font-semibold text-near-black/35 uppercase tracking-wider mb-3">Environmental Conditions</p>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                    {[
                      { label: 'Temperature', value: reportData.testConditions.temperature },
                      { label: 'Humidity', value: reportData.testConditions.humidity },
                      { label: 'Pressure', value: reportData.testConditions.atmosphericPressure },
                      { label: 'Location', value: reportData.testConditions.location },
                    ].filter(r => r.value).map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-[10px] text-near-black/30 uppercase tracking-wider">{label}</p>
                        <p className="text-xs font-semibold text-near-black mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Test Results Table */}
              <div className="mb-6">
                <p className="text-[10px] font-semibold text-near-black/35 uppercase tracking-wider mb-3">Evaluation Summary</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-near-black/10">
                      <th className="pb-2 text-left text-[10px] font-semibold text-near-black/35 uppercase tracking-wider">Test Designation</th>
                      <th className="pb-2 text-center text-[10px] font-semibold text-near-black/35 uppercase tracking-wider">Clause</th>
                      <th className="pb-2 text-right text-[10px] font-semibold text-near-black/35 uppercase tracking-wider">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-near-black/5">
                    {testResults.length === 0 ? (
                      <tr><td colSpan={3} className="py-4 text-center text-[10px] text-near-black/25">No tests recorded</td></tr>
                    ) : testResults.map((t: any) => (
                      <tr key={t.testName}>
                        <td className="py-2.5 text-xs font-medium text-near-black">{t.testName}</td>
                        <td className="py-2.5 text-center font-mono text-[10px] text-near-black/35">{t.testCode || '—'}</td>
                        <td className="py-2.5 text-right">
                          <span className={cn('text-xs font-bold', t.passed ? 'text-emerald' : 'text-red')}>
                            {t.passed ? 'PASS' : 'FAIL'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Overall */}
              {overallResult && (
                <div className={cn(
                  'rounded-lg px-4 py-3 mb-6 text-center border',
                  overallResult === 'Pass' ? 'bg-emerald/8 border-emerald/20 text-emerald' :
                    overallResult === 'Fail' ? 'bg-red/8 border-red/20 text-red' :
                      'bg-signal-orange/8 border-signal-orange/20 text-signal-orange'
                )}>
                  <p className="text-sm font-bold uppercase tracking-widest">
                    OVERALL RESULT: {overallResult.toUpperCase()}
                  </p>
                </div>
              )}

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-8 pt-4 border-t-2 border-near-black">
                {[
                  { name: reportData.inspector || 'Lead Inspector', role: 'Lead Inspector' },
                  { name: 'Authorised Signatory', role: 'Laboratory Head' },
                ].map(s => (
                  <div key={s.role}>
                    <div className="h-8 border-b border-near-black/15 mb-1.5" />
                    <p className="text-[10px] font-bold text-near-black">{s.name}</p>
                    <p className="text-[9px] text-near-black/30">{s.role} · Seal & Date</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-near-black/4 px-10 py-2.5 text-center">
              <p className="text-[9px] text-near-black/30">Generated by MaapSetu · OIML R 76-1:2006</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
