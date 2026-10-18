"""q-guide.md: the founder's qGuide instructions as a short guide document."""
from common import FOOTER, cdir, companies

PERSONALITY = {"WARM": "warm", "DIRECT": "direct", "FORMAL": "formal", "WITTY": "witty"}


def build():
    for c in companies():
        fp = c["founderPerson"]
        tone = PERSONALITY.get(c.get("qPersonality", ""))  # AUTO: let Q choose, no line
        lines = [f"# How Q should talk about {c['company']}", "",
                 f"*Guidance from {fp['name']}, {fp['role']}. {FOOTER}.*", "",
                 f"{c['shortDescription']}", ""]
        if tone:
            lines += [f"**Preferred Q tone:** {tone}.", ""]
        lines += ["## Guidance", ""] + [f"{k}. {g}" for k, g in enumerate(c["qGuide"], 1)] + [""]
        open(f"{cdir(c)}/q-guide.md", "w").write("\n".join(lines))
    print("q guides written")


if __name__ == "__main__":
    build()
