// Copy beside your document, import `report`, and customize freely.
#let report(
  title: none,
  author: none,
  paper: "a4",
  margin: (x: 20mm, y: 20mm),
  body-font: "Libertinus Serif",
  heading-font: "Libertinus Serif",
  font-size: 11pt,
  lang: "en",
  accent: rgb("253647"),
  body,
) = {
  set document(title: title, author: if author == none { () } else { author })
  set page(paper: paper, margin: margin, numbering: "1")
  set text(font: body-font, size: font-size, lang: lang)
  set par(leading: 0.65em)
  show heading: set text(font: heading-font, fill: accent)
  show heading: set block(above: 1.3em, below: 0.6em)
  set table(inset: 6pt, stroke: 0.4pt + rgb("d0d4d8"))

  if title != none {
    text(font: heading-font, size: 24pt, weight: "bold", fill: accent, title)
    v(6pt)
  }
  if author != none {
    text(size: 10pt, author)
    v(6pt)
  }
  body
}
