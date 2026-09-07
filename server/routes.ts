import express from 'express';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { Instrument, Report, TestResult, User, OimlRule } from './models';
import PDFDocument from 'pdfkit';
import {
  evaluateWeighingPerformance,
  evaluateRepeatability,
  evaluateEccentricity,
  evaluateDiscrimination,
  evaluateTare,
  determineOverallResult,
  getMPE,
  computeNMax,
  verifyClassConsistency,
  getRuleSetInfo,
  getTestTypes,
  getRules,
  type AccuracyClass,
} from './oiml-engine';
import { GoogleGenAI } from '@google/genai';

const router = express.Router();

// ─── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && user.password === password) {
      res.json({ id: user._id, email: user.email, name: user.name, role: user.role });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const users = await User.find().select('name email role designation laboratory');
  res.json(users);
});

// ─── Instruments ───────────────────────────────────────────────────────────────
router.get('/instruments', async (req, res) => {
  const query = req.query.q
    ? { $or: [{ model: new RegExp(req.query.q as string, 'i') }, { manufacturer: new RegExp(req.query.q as string, 'i') }] }
    : {};
  const instruments = await Instrument.find(query).sort('-createdAt');
  res.json(instruments);
});

router.post('/instruments', async (req, res) => {
  try {
    const instrument = new Instrument(req.body);
    await instrument.save(); // triggers pre-save nMax computation
    res.json(instrument);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/instruments/:id', async (req, res) => {
  const instrument = await Instrument.findById(req.params.id);
  res.json(instrument);
});

router.put('/instruments/:id', async (req, res) => {
  const instrument = await Instrument.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(instrument);
});

// ─── Reports ───────────────────────────────────────────────────────────────────
router.get('/reports', async (req, res) => {
  const filter: any = {};
  if (req.query.status) filter.status = req.query.status;
  const reports = await Report.find(filter).populate('instrumentId').sort('-updatedAt');
  res.json(reports);
});

router.post('/reports', async (req, res) => {
  try {
    const report = await Report.create(req.body);
    res.json(report);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/reports/:id', async (req, res) => {
  const { id } = req.params;
  if (!id || !mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid report ID' });
  }
  const report = await Report.findById(id).populate('instrumentId');
  const results = await TestResult.find({ reportId: id });
  res.json({ ...report?.toObject(), testResults: results });
});

router.put('/reports/:id', async (req, res) => {
  const report = await Report.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(report);
});

router.delete('/reports/:id', async (req, res) => {
  await Report.findByIdAndDelete(req.params.id);
  await TestResult.deleteMany({ reportId: req.params.id });
  res.json({ success: true });
});

// ─── Test Results ──────────────────────────────────────────────────────────────
router.post('/reports/:id/tests', async (req, res) => {
  try {
    const { testName, testCode, data, passed } = req.body;
    const result = await TestResult.findOneAndUpdate(
      { reportId: req.params.id, testName },
      { data, passed, testCode },
      { new: true, upsert: true }
    );
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ─── OIML Engine Endpoints ─────────────────────────────────────────────────────

// Evaluate a single weighing performance test
router.post('/oiml/weighing', async (req, res) => {
  const { rows, eG, cls } = req.body as { rows: any[]; eG: number; cls: AccuracyClass };
  const result = evaluateWeighingPerformance(rows, eG, cls);
  res.json(result);
});

// Evaluate repeatability
router.post('/oiml/repeatability', async (req, res) => {
  const { readings, eG } = req.body;
  res.json(evaluateRepeatability(readings, eG));
});

// Evaluate eccentricity
router.post('/oiml/eccentricity', async (req, res) => {
  const { rows, testLoadG, eG, cls } = req.body;
  res.json(evaluateEccentricity(rows, testLoadG, eG, cls));
});

// Evaluate discrimination
router.post('/oiml/discrimination', async (req, res) => {
  const { loadG, indicationBefore, indicationAfter, addedWeightG, dG } = req.body;
  res.json(evaluateDiscrimination(loadG, indicationBefore, indicationAfter, addedWeightG, dG));
});

// Evaluate tare
router.post('/oiml/tare', async (req, res) => {
  const { tareMassG, indicationAfterTare, eG } = req.body;
  res.json(evaluateTare(tareMassG, indicationAfterTare, eG));
});

// Get MPE for a load
router.post('/oiml/mpe', async (req, res) => {
  const { loadG, eG, cls } = req.body;
  res.json({ mpe: getMPE(loadG, eG, cls) });
});

// Verify class consistency
router.post('/oiml/verify-class', async (req, res) => {
  const { cls, nMax } = req.body;
  res.json(verifyClassConsistency(cls, nMax));
});

// Finalize report — compute overall result and update
router.post('/reports/:id/finalize', async (req, res) => {
  const results = await TestResult.find({ reportId: req.params.id });
  const { result, failedTests } = determineOverallResult(
    results.map(r => ({ testName: r.testName, passed: r.passed }))
  );
  const status = result === 'Pass' ? 'Completed' : result === 'Fail' ? 'Failed' : 'Under Review';
  const report = await Report.findByIdAndUpdate(
    req.params.id,
    { overallResult: result, status, reviewedAt: new Date() },
    { new: true }
  );
  res.json({ report, overallResult: result, failedTests });
});

// ─── AI Endpoints (Gemini) ─────────────────────────────────────────────────────
router.post('/ai/test-summary', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

    const { testName, data, passed, instrumentInfo } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are an expert OIML R-76 NAWI calibration engineer. Write a concise, professional 2-3 sentence technical summary for the following test result that would appear in an official calibration report.

Test: ${testName}
Instrument: ${instrumentInfo || 'NAWI'}
Result: ${passed ? 'PASS' : 'FAIL'}
Data: ${JSON.stringify(data, null, 2)}

Keep it formal, mention key values, and state compliance status. Do not use bullet points.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });

    const summary = response.text || '';
    res.json({ summary });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/ai/compliance-advice', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

    const { failedTests, instrumentClass, oimlVersion } = req.body;
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are an expert in OIML R-76 (${oimlVersion}) NAWI type evaluation. A Class ${instrumentClass} instrument has failed the following tests: ${failedTests.join(', ')}.

Provide a brief (3-4 sentences) professional recommendation to the laboratory regarding:
1. Likely causes of failure for these specific tests
2. What corrective actions the manufacturer might take
3. Whether re-testing is appropriate

Keep the language formal and technical.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });

    res.json({ advice: response.text || '' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
router.get('/dashboard/stats', async (req, res) => {
  const [total, draft, inProgress, completed, failed, underReview] = await Promise.all([
    Report.countDocuments(),
    Report.countDocuments({ status: 'Draft' }),
    Report.countDocuments({ status: 'In Progress' }),
    Report.countDocuments({ status: 'Completed' }),
    Report.countDocuments({ status: 'Failed' }),
    Report.countDocuments({ status: 'Under Review' }),
  ]);

  // Monthly data for last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const monthly = await Report.aggregate([
    { $match: { createdAt: { $gte: sixMonthsAgo } } },
    {
      $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
        count: { $sum: 1 },
        passed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'Failed'] }, 1, 0] } },
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyData = monthly.map((m: any) => ({
    month: monthNames[m._id.month - 1],
    total: m.count,
    passed: m.passed,
    failed: m.failed,
  }));

  res.json({ total, draft, inProgress, completed, failed, underReview, monthlyData });
});

// ─── OIML Rules ───────────────────────────────────────────────────────────────
router.get('/oiml-rules', async (req, res) => {
  const rules = await OimlRule.find().sort('testCode');
  res.json(rules);
});

// ─── PDF Generation ───────────────────────────────────────────────────────────
router.get('/reports/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Report ID is missing or invalid' });
    }
    const report = await Report.findById(id).populate('instrumentId');
    const results = await TestResult.find({ reportId: id });

    if (!report) return res.status(404).send('Report not found');

    const doc = new PDFDocument({ margin: 55, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=NAWI-Report-${report.applicationNo}.pdf`);
    doc.pipe(res);

    const inst = report.instrumentId as any;
    const W = doc.page.width - 110;
    const LEFT = 55;
    const RIGHT = LEFT + W;
    const BLUE = '#123B5D';
    const LIME = '#C7F36B';
    const BLACK = '#101214';
    const GRAY = '#6B7280';
    const LGRAY = '#F3F4F6';

    // ── Header bar ──────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill(BLUE);
    doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold')
      .text('NAWI TEST REPORT', LEFT, 22, { width: W * 0.6 });
    doc.fontSize(9).font('Helvetica').fillColor('#C7F36B')
      .text('OIML R 76-1 | Non-Automatic Weighing Instruments', LEFT, 46, { width: W * 0.6 });

    // Report number top-right
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold')
      .text(report.applicationNo, RIGHT - 130, 28, { width: 130, align: 'right' });
    doc.fillColor('#C7F36B').fontSize(8).font('Helvetica')
      .text(`Status: ${report.status}`, RIGHT - 130, 44, { width: 130, align: 'right' });

    doc.y = 95;

    // ── Helper: section heading ──────────────────────────────────────
    const sectionHeading = (title: string) => {
      doc.moveDown(0.5);
      doc.rect(LEFT, doc.y, W, 18).fill(BLACK);
      doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold')
        .text(title.toUpperCase(), LEFT + 8, doc.y + 4, { width: W - 16 });
      doc.y += 22;
    };

    // ── Helper: two-column row ───────────────────────────────────────
    const row2 = (label1: string, val1: string, label2: string, val2: string) => {
      const y = doc.y;
      const half = W / 2;
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(label1, LEFT, y);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK).text(val1 || '—', LEFT, y + 11);
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(label2, LEFT + half + 5, y);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK).text(val2 || '—', LEFT + half + 5, y + 11);
      doc.y = y + 28;
    };

    const row1 = (label: string, val: string) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(label, LEFT, y);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK).text(val || '—', LEFT, y + 11);
      doc.y = y + 28;
    };

    // ── Section 1: General ───────────────────────────────────────────
    sectionHeading('1. General Information');
    row2('Application No.', report.applicationNo,
      'Date of Test', new Date(report.date || new Date()).toLocaleDateString('en-IN'));
    row2('Lead Inspector', report.inspector || '—',
      'Laboratory', report.laboratory || '—');
    row2('Purpose of Test', report.purposeOfTest || 'Model Approval',
      'OIML Standard', 'OIML R 76-1 (2006)');
    if (report.applicantName)
      row2('Applicant', report.applicantName,
        'Address', report.applicantAddress || '—');

    // ── Section 2: Instrument Details ───────────────────────────────
    sectionHeading('2. Instrument Details');
    row2('Manufacturer', inst?.manufacturer || '—',
      'Model', inst?.model || '—');
    row2('Serial Number', inst?.serialNumber || '—',
      'Accuracy Class', inst?.accuracyClass ? `Class ${inst.accuracyClass}` : '—');
    row2('Max Capacity', inst?.maxCapacity ? `${inst.maxCapacity} kg` : '—',
      'Min Capacity', inst?.minCapacity ? `${inst.minCapacity} g` : '—');
    row2('Scale Interval (e)', inst?.eValue ? `${inst.eValue} g` : '—',
      'Actual Scale (d)', inst?.dValue ? `${inst.dValue} g` : '—');

    // ── Section 3: Environmental Conditions ─────────────────────────
    sectionHeading('3. Environmental Conditions');
    const tc = (report as any).testConditions || {};
    row2('Temperature', tc.temperature || '—',
      'Relative Humidity', tc.humidity || '—');
    row2('Atmospheric Pressure', tc.atmosphericPressure || '—',
      'Location', tc.location || '—');
    if (tc.referenceStandards) row1('Reference Standards / Equipment', tc.referenceStandards);

    // ── Section 4: Test Results ──────────────────────────────────────
    sectionHeading('4. Test Observations & Results');

    if (!results.length) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('No test data recorded.', LEFT, doc.y);
      doc.y += 18;
    }

    for (const result of results) {
      if (doc.y > doc.page.height - 120) doc.addPage();

      const passColor = result.passed ? '#159A70' : '#E05252';
      const passText = result.passed ? 'PASS' : 'FAIL';

      // Test header
      const th = doc.y;
      doc.rect(LEFT, th, W, 16).fill(LGRAY);
      doc.fillColor(BLACK).font('Helvetica-Bold').fontSize(9)
        .text(result.testName, LEFT + 6, th + 3, { width: W - 70 });
      doc.fillColor(passColor).font('Helvetica-Bold').fontSize(9)
        .text(passText, RIGHT - 50, th + 3, { width: 45, align: 'right' });
      doc.y = th + 20;

      // AI summary if present
      if ((result as any).aiSummary) {
        doc.font('Helvetica').fontSize(8).fillColor(GRAY)
          .text((result as any).aiSummary, LEFT + 6, doc.y, { width: W - 12 });
        doc.y += doc.currentLineHeight() + 6;
      }

      // Data rows (simplified rendering of test data)
      const data = typeof result.data === 'object' ? result.data : {};
      if (Array.isArray(data)) {
        // Weighing performance — render as mini table
        const headers = ['Load (g)', 'Ind (g)', 'Add (g)', 'P (g)', 'E (g)', 'Ec (g)', 'MPE', 'Result'];
        const colW = W / headers.length;
        const hy = doc.y;
        doc.rect(LEFT, hy, W, 14).fill('#E5E7EB');
        headers.forEach((h, i) => {
          doc.fillColor(BLACK).font('Helvetica-Bold').fontSize(7)
            .text(h, LEFT + i * colW + 2, hy + 3, { width: colW - 4 });
        });
        doc.y = hy + 14;

        for (const row of data as any[]) {
          if (doc.y + 14 > doc.page.height - 80) doc.addPage();
          const ry = doc.y;
          const vals = [row.load, row.ind, row.add, row.calc ?? row.P, row.err ?? row.E, row.corr ?? row.Ec, row.mpe ?? row.MPE, row.result];
          vals.forEach((v, i) => {
            const color = i === 7 ? (v === 'Fail' ? '#E05252' : v === 'Review' ? '#FF7043' : '#159A70') : BLACK;
            doc.fillColor(color).font(i === 7 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7)
              .text(v !== undefined ? String(v) : '—', LEFT + i * colW + 2, ry + 3, { width: colW - 4 });
          });
          doc.y = ry + 14;
        }
      } else {
        const keys = Object.keys(data as object);
        for (let i = 0; i < keys.length; i += 2) {
          if (doc.y + 20 > doc.page.height - 80) doc.addPage();
          const k1 = keys[i], v1 = String((data as any)[k1] ?? '—');
          const k2 = keys[i + 1], v2 = k2 ? String((data as any)[k2] ?? '—') : '';
          row2(k1, v1, k2 || '', v2);
        }
      }
      doc.y += 8;
    }

    // ── Section 5: Overall Determination ────────────────────────────
    sectionHeading('5. Overall Determination');
    const overall = (report as any).overallResult || 'Inconclusive';
    const oColor = overall === 'Pass' ? '#159A70' : overall === 'Fail' ? '#E05252' : '#FF7043';

    const boxY = doc.y;
    doc.rect(LEFT, boxY, W, 40).stroke(oColor);
    doc.fillColor(oColor).font('Helvetica-Bold').fontSize(16)
      .text(`OVERALL RESULT: ${overall.toUpperCase()}`, LEFT, boxY + 11, { width: W, align: 'center' });
    doc.y = boxY + 50;

    if ((report as any).remarks) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Remarks:', LEFT, doc.y);
      doc.font('Helvetica').fontSize(9).fillColor(BLACK).text((report as any).remarks, LEFT, doc.y + 12, { width: W });
      doc.y += 28;
    }

    // ── Section 6: Signatures ────────────────────────────────────────
    if (doc.y + 80 > doc.page.height - 60) doc.addPage();
    sectionHeading('6. Signatures & Approval');

    const sigY = doc.y + 10;
    const sigW = (W - 30) / 2;
    [
      { label: report.inspector || 'Inspector', role: 'Lead Inspector' },
      { label: 'Authorised Signatory', role: 'Laboratory Head' },
    ].forEach((s, i) => {
      const sx = LEFT + i * (sigW + 30);
      doc.rect(sx, sigY + 30, sigW, 1).stroke('#CBD5E1');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK).text(s.label, sx, sigY + 36);
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(s.role, sx, sigY + 48);
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Seal & Date', sx + sigW - 70, sigY + 48);
    });

    doc.y = sigY + 70;

    // ── Footer (first page) ──────────────────────────────────────────
    const ftY = doc.page.height - 35;
    doc.rect(0, ftY, doc.page.width, 35).fill('#F8F7F2');
    doc.fillColor(GRAY).fontSize(7).font('Helvetica')
      .text(`Generated by MaapSetu · ${new Date().toLocaleString('en-IN')} · OIML R 76-1:2006`, 0, ftY + 10, { width: doc.page.width, align: 'center' });

    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).send('Error generating PDF');
  }
});

export { router as apiRouter };
