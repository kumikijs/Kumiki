const REPO = "https://github.com/kumikijs/Kumiki";

const headline = (summary) =>
  summary
    .trim()
    .split(/\n\s*\n/)[0]
    .replace(/\s*\n\s*/g, " ");

module.exports = {
  getReleaseLine: async (changeset) => {
    const link = changeset.commit
      ? ` ([${changeset.commit.slice(0, 7)}](${REPO}/commit/${changeset.commit}))`
      : "";
    return `- ${headline(changeset.summary)}${link}`;
  },
  getDependencyReleaseLine: async () => "",
};
