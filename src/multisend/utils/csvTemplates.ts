export function downloadTemplateFile(): void {
  const fileName = 'multi_transfer_template.csv';
  const a = document.createElement('a');
  a.href = `/templates/${encodeURIComponent(fileName)}`;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
