const WEB_CITATION_MARKER = /[ \t]*\uE200cite(?:\uE202turn\d+[a-z]+\d+)+\uE201/g;

export function stripCitationMarkers(content: string): string {
  return content.replace(WEB_CITATION_MARKER, "");
}
