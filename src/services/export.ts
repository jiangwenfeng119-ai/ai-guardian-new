
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from 'docx';
import { jsPDF } from 'jspdf';
import { Finding, Control, Standard } from '../types';

export type DeepEvalTaskReport = {
  id: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  total: number;
  done: number;
  updatedFindings: number;
  affectedAssessmentIds: string[];
  reportSummary?: string;
  error?: string;
};

export const EXPORT_SERVICE = {
  // Export to Excel
  exportToExcel: (findings: Finding[], controls: Control[], standardName: string) => {
    const data = findings.map(f => {
      const control = controls.find(c => c.id === f.controlId);
      return {
        '控制项ID': f.controlId,
        '名称': control?.name || '',
        '合规要求': control?.requirement || '',
        '合规状态': f.status,
        '检查结果': f.evidence,
        '差距分析': f.analysis,
        '整改建议': f.recommendation
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '评估清单');
    XLSX.writeFile(workbook, `${standardName}_评估清单_${new Date().toLocaleDateString()}.xlsx`);
  },

  // Export Standard Template to Excel
  exportTemplateToExcel: (controls: Control[], standardName: string) => {
    const data = controls.map(c => ({
      '控制项ID': c.id,
      '检查项名称': c.name,
      '重要级别': c.priority,
      '合规要求': c.requirement,
      '自动化核查命令': c.command || 'N/A',
      '检查结果 (人工填写)': '', 
      '合规结论 (Compliant/Non-Compliant/Partial)': ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '标准检查清单');
    XLSX.writeFile(workbook, `${standardName}_标准检查清单模板_${new Date().toLocaleDateString()}.xlsx`);
  },

  // Export to Word (docx)
  exportToWord: async (findings: Finding[], controls: Control[], standardName: string, summary: string) => {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: `${standardName} 安全合规评估报告`,
            heading: HeadingLevel.TITLE,
          }),
          new Paragraph({
            text: "执行摘要",
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          }),
          new Paragraph({
            children: [new TextRun(summary)],
          }),
          new Paragraph({
            text: "评估详细记录",
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          }),
          ...findings.flatMap(f => {
            const control = controls.find(c => c.id === f.controlId);
            return [
              new Paragraph({
                text: `${f.controlId}: ${control?.name}`,
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 200 },
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: "合规状态: ", bold: true }),
                  new TextRun({ text: f.status, color: f.status === 'Compliant' ? '008000' : 'FF0000' })
                ]
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: "差距分析: ", bold: true }),
                  new TextRun(f.analysis)
                ]
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: "整改建议: ", bold: true }),
                  new TextRun(f.recommendation)
                ]
              })
            ];
          })
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${standardName}_评估报告.docx`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // Export to PDF
  exportToPDF: (findings: Finding[], controls: Control[], standardName: string) => {
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text(`${standardName} Compliance Report`, 10, 20);
    doc.setFontSize(12);
    
    let y = 30;
    findings.forEach((f, i) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.text(`${f.controlId}: ${f.status}`, 10, y);
      y += 10;
    });
    
    doc.save(`${standardName}_Assessment.pdf`);
  },

  exportDeepEvalTaskToWord: async (task: DeepEvalTaskReport) => {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: `深度评估任务报告 - ${task.id}`,
            heading: HeadingLevel.TITLE,
          }),
          new Paragraph({
            text: `状态：${task.status}`,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: `开始时间：${new Date(task.startedAt).toLocaleString()}`,
          }),
          new Paragraph({
            text: `完成时间：${task.finishedAt ? new Date(task.finishedAt).toLocaleString() : '—'}`,
          }),
          new Paragraph({
            text: `进度：${task.done}/${task.total}`,
          }),
          new Paragraph({
            text: `更新项：${task.updatedFindings}`,
          }),
          new Paragraph({
            text: `影响任务数：${task.affectedAssessmentIds.length}`,
          }),
          new Paragraph({
            text: `影响任务ID：${task.affectedAssessmentIds.join(', ') || '—'}`,
          }),
          new Paragraph({
            text: `摘要：${task.reportSummary || '—'}`,
            spacing: { before: 150, after: 100 },
          }),
          new Paragraph({
            text: `错误信息：${task.error || '—'}`,
          }),
        ],
      }],
    });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deep-eval-report-${task.id}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  },

  exportDeepEvalTaskToPDF: (task: DeepEvalTaskReport) => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`Deep Evaluation Report: ${task.id}`, 10, 20);
    doc.setFontSize(11);
    const lines = [
      `Status: ${task.status}`,
      `Started: ${new Date(task.startedAt).toLocaleString()}`,
      `Finished: ${task.finishedAt ? new Date(task.finishedAt).toLocaleString() : '-'}`,
      `Progress: ${task.done}/${task.total}`,
      `Updated findings: ${task.updatedFindings}`,
      `Affected assessments: ${task.affectedAssessmentIds.length}`,
      `Affected IDs: ${task.affectedAssessmentIds.join(', ') || '-'}`,
      `Summary: ${task.reportSummary || '-'}`,
      `Error: ${task.error || '-'}`,
    ];
    let y = 32;
    lines.forEach((line) => {
      const wrapped = doc.splitTextToSize(line, 185);
      wrapped.forEach((chunk: string) => {
        if (y > 280) {
          doc.addPage();
          y = 20;
        }
        doc.text(chunk, 10, y);
        y += 7;
      });
    });
    doc.save(`deep-eval-report-${task.id}.pdf`);
  }
};
