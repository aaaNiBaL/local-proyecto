import type jsPDF from "jspdf";

type RGB = [number, number, number];

export const pdfColors: Record<"primary" | "pale" | "border" | "text" | "muted" | "alternate", RGB> = {
  primary: [24, 110, 58],
  pale: [241, 247, 242],
  border: [218, 228, 220],
  text: [35, 48, 40],
  muted: [100, 112, 103],
  alternate: [246, 248, 246],
};

export function addPdfSummaryCards(
  doc: jsPDF,
  y: number,
  metrics: { label: string; value: string }[],
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const gap = 4;
  const cardWidth = (pageWidth - margin * 2 - gap * (metrics.length - 1)) / metrics.length;

  metrics.forEach((metric, index) => {
    const x = margin + index * (cardWidth + gap);
    doc.setDrawColor(...pdfColors.border);
    doc.setFillColor(...pdfColors.pale);
    doc.roundedRect(x, y, cardWidth, 22, 2, 2, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...pdfColors.muted);
    doc.text(metric.label.toLocaleUpperCase("es-CL"), x + 3, y + 7);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...pdfColors.text);
    doc.text(metric.value, x + 3, y + 16);
  });
}

export function addPdfSectionHeading(doc: jsPDF, title: string, description: string, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...pdfColors.text);
  doc.text(title, 14, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...pdfColors.muted);
  doc.text(description, 14, y + 5);
  return y + 10;
}

export function addPdfPageChrome(doc: jsPDF, title: string, subtitle: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();
  const generatedAt = new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFillColor(...pdfColors.primary);
    doc.rect(0, 0, pageWidth, 32, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title, 14, 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(subtitle, 14, 23);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("INVenco", pageWidth - 14, 14, { align: "right" });

    doc.setDrawColor(...pdfColors.border);
    doc.line(14, pageHeight - 15, pageWidth - 14, pageHeight - 15);
    doc.setTextColor(...pdfColors.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`Invenco · Generado ${generatedAt}`, 14, pageHeight - 9);
    doc.text(`Página ${page} de ${pageCount}`, pageWidth - 14, pageHeight - 9, {
      align: "right",
    });
  }
}
