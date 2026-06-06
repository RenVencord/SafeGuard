import { definePluginSettings } from "@api/Settings";
import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, Forms, Menu, React } from "@webpack/common";

let bypassNext = false;

const MessageActions = findByPropsLazy("sendMessage", "editMessage");
const DMChannelStore = findByPropsLazy("getDMFromUserId");

// ─── Settings ─────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    checkAmbiguous: {
        type: OptionType.BOOLEAN,
        description: "Warn on short, ambiguous messages (e.g. 'yes', 'no', 'sure') that can be screenshotted out of context",
        default: true,
    },
    checkAge: {
        type: OptionType.BOOLEAN,
        description: "Warn when your message implies someone is under 18 (e.g. 'im 11', '12yo')",
        default: true,
    },
    checkSlurs: {
        type: OptionType.BOOLEAN,
        description: "Warn when your message contains slurs or hate speech — even used casually, these can get you banned",
        default: true,
    },
    checkThreats: {
        type: OptionType.BOOLEAN,
        description: "Warn on threats, sexual violence, doxxing/swatting, and blackmail language (even as a joke)",
        default: true,
    },
    checkSelfHarm: {
        type: OptionType.BOOLEAN,
        description: "Warn on self-harm encouragement like 'kys', 'kill yourself', 'go rope', 'kms', and the veiled 'keep yourself safe'",
        default: true,
    },
    checkGrooming: {
        type: OptionType.BOOLEAN,
        description: "Warn on grooming-adjacent phrases like 'don\'t tell anyone', 'our little secret', 'are you alone'",
        default: true,
    },
    checkSolicitation: {
        type: OptionType.BOOLEAN,
        description: "Warn when your message solicits nude or sexual images (e.g. 'send nudes', 'feet pics')",
        default: true,
    },
    checkRaiding: {
        type: OptionType.BOOLEAN,
        description: "Warn on server raiding or spam coordination language (e.g. 'let\'s raid', 'mass ping')",
        default: true,
    },
    customWords: {
        type: OptionType.STRING,
        description: "Custom words or phrases to flag, comma-separated (e.g. 'my address, meet irl')",
        default: "",
    },
    whitelistedChannels: {
        type: OptionType.STRING,
        description: "Channel IDs where SafeGuard is fully disabled, comma-separated (right-click a channel → Copy Channel ID)",
        default: "",
    },
});

// ─── Patterns ─────────────────────────────────────────────────────────────────

const AMBIGUOUS_SINGLE = new RegExp(
    "^(" + [
        "yes", "yeah", "yep", "yup", "ya", "yea", "ye",
        "sure", "alright", "alr", "aight", "ight",
        "no", "nah", "nope", "naw", "na",
        "k", "ok", "okay", "okie",
        "fine", "whatever", "w\/e",
        "maybe", "idk", "ik", "ikr",
        "lol", "lmao", "lmfao", "haha", "hehe", "heh", "lel",
        "true", "false", "right", "wrong", "correct",
        "exactly", "agreed", "bet", "facts", "cap",
        "fr", "frfr", "word",
        "gotcha", "gotchu", "got it", "understood",
        "noted", "heard", "done", "sent", "seen",
        "cool", "nice", "okay cool", "ok cool",
        "me too", "same", "same here", "same lol", "same tbh",
        "me neither", "i agree", "i disagree", "i know", "i know right",
        "of course", "absolutely", "definitely", "certainly",
    ].join("|") + ")[.!?]*$",
    "i"
);


const AMBIGUOUS_PHRASES: RegExp[] = [
    // affirmative + i [verb] (optional "not")
    /^(yes|yeah|yep|yup|sure|of course|absolutely|definitely|certainly)\s+i('?m|'?\s*am|'?\s*do|'?\s*did|'?\s*have|'?\s*will|'?\s*would|'?\s*can|'?\s*could|'?\s*should|'?\s*was|'?\s*were)(\s+not)?[.!?]*$/i,
    // negative + i [verb]
    /^(no|nah|nope|not really)\s+i('?m\s+not|'?\s*am\s+not|\s+don'?t|'?\s*didn'?t|'?\s*haven'?t|'?\s*won'?t|'?\s*wouldn'?t|'?\s*can'?t|'?\s*couldn'?t|'?\s*wasn'?t|'?\s*weren'?t)[.!?]*$/i,
    // bare "i am" / "i do" / "i did" etc. with optional "not"
    /^i\s+(am|do|did|have|will|would|can|could|should|was|were)(\s+not)?[.!?]*$/i,
    // "i'm" / "i'm not" on their own
    /^i'?m(\s+not)?[.!?]*$/i,
    // one short trailing word still leaves it context-free: "yes i am too", "no i didn't either"
    /^(yes|yeah|sure|no|nah|nope)\s+i\s+(am|do|did|was|will|would|can|didn't|don't|won't|can't)(\s+\w+)?[.!?]*$/i,
];


const AGE_PATTERNS: RegExp[] = [
    // "im 11" / "i'm 12" / "i am 10"
    /\bi'?m\s+(?:only\s+|just\s+)?(?:1[0-7]|\d)\b/i,
    /\bi\s+am\s+(?:only\s+|just\s+)?(?:1[0-7]|\d)\b/i,
    // "11 years old" / "11yo" / "11 y/o"
    /\b(?:1[0-7]|\d)\s*(?:years?\s*old|yo\b|y\/o)/i,
    // "age: 11" / "aged 11"
    /\bage[d]?\s*[:\-]?\s*(?:1[0-7]|\d)\b/i,
    // "turning 11" / "just turned 11"
    /\b(?:turn(?:ing|ed)|just\s+turned)\s+(?:1[0-7]|\d)\b/i,
    // "my age is 11"
    /\bmy\s+age\s+is\s+(?:1[0-7]|\d)\b/i,
    // "14f" / "12m" — age/gender combos common in certain communities
    /\b(?:1[0-7]|\d)[mf]\b/i,
    // Standalone 1-2 digit number — "11" on its own with zero context
    /^(?:1[0-7]|\d)$/,
];


const SLUR_PATTERNS: RegExp[] = [
    // ── RACIAL ───────────────────────────────────────────────────────────────
    // N-word and variants
    /\bn[i1!|][g69]{1,2}(?:er|a|ah|as|ers|az|uh|ga)?\b/i,
    // Coon
    /\bc[o0]{2}n\b/i,
    // Kike
    /\bk[i1]ke\b/i,
    // Chink
    /\bch[i1!]nk\b/i,
    // Gook
    /\bg[o0]{2}k\b/i,
    // Spic / Spick
    /\bsp[i1][ck]k?\b/i,
    // Wetback
    /\bwetback\b/i,
    // Beaner
    /\bbeaner\b/i,
    // Paki
    /\bp[a4]ki\b/i,
    // Slant-eye
    /\bslant[- ]?eye[sd]?\b/i,
    // Zipperhead
    /\bzipperhead\b/i,
    // Jap (anti-Japanese slur; does NOT match "Japan")
    /\bjap\b/i,
    // Honky / Honkie
    /\bh[o0]nk[ey]\b/i,
    // Redskin
    /\bredskin\b/i,
    // Towelhead / Raghead
    /\b(?:towelhead|raghead)\b/i,
    // Sand + n-word compound
    /\bsand\s*n[i1][g69]+(?:er|a)?\b/i,
    // Porch monkey
    /\bporch\s*monk[e]?y\b/i,
    // Jungle bunny
    /\bjungle\s*bunny\b/i,
    // Curry muncher
    /\bcurry\s*muncher\b/i,
    // Gypo / Gyppo / Gypsy (Romani slur)
    /\bgyp(?:po|py|o|sy)\b/i,
    // Darkie
    /\bdark[yi]e\b/i,
    // Sambo (racial)
    /\bsambo\b/i,
    // Yid (sometimes reclaimed, still flaggable)
    /\byid\b/i,
    // Hymie / Heeb (antisemitic)
    /\b(?:hymie|heeb)\b/i,
    // ── HOMOPHOBIC / TRANSPHOBIC ──────────────────────────────────────────────
    // F-word / faggot
    /\bf[a4][g9](?:g[oi]t|got)?\b/i,
    // Dyke
    /\bd[y1]k[e3]\b/i,
    // Shemale
    /\bshe[- ]?male\b/i,
    // Tranny
    /\btr[a4]nn[yi]e?\b/i,
    // Poofter
    /\bpoo?ft[e]?r\b/i,
    // Sodomite (used as a slur)
    /\bsodomite\b/i,
    // ── DISABILITY ────────────────────────────────────────────────────────────
    // Retard / Retarded
    /\br[e3]t[a4]rd(?:ed|s)?\b/i,
    // Spaz / Spastic
    /\bsp[a4]zz?\b/i,
    /\bsp[a4]stic\b/i,
    // Mong / Mongoloid
    /\bmong(?:oloid)?\b/i,
    // ── GENDERED ──────────────────────────────────────────────────────────────
    // C-word
    /\bc[u*]nt\b/i,
    // Slut
    /\bsl[u*]t\b/i,
    // Whore
    /\bwh[o*]r[e3]\b/i,
    // Skank
    /\bskank\b/i,
    // Twat
    /\btw[a4]t\b/i,
    // ── NAZI / HATE SYMBOLS ───────────────────────────────────────────────────
    // Heil Hitler / Sieg Heil
    /\b(?:heil|sieg)\s+(?:hitler|heil)\b/i,
    // 1488 (14 Words + HH)
    /\b1488\b/,
    // White power / White supremacy
    /\bwhite\s+(?:power|supremac[y])\b/i,
];


const THREAT_PATTERNS: RegExp[] = [
    // "I'll kill/hurt/stab/shoot/beat you"
    /\b(?:i(?:'ll|\s+will|\s+am\s+gonna|\s+gonna|'?m\s+gonna))\s+(?:kill|murder|hurt|beat(?:\s+(?:you|u)\s+up)?|stab|shoot|assault|harm)\s+(?:you|u)\b/i,
    // Sexual violence as a threat: "I'll rape you", "gonna rape you", "I'll sexually assault you"
    /\b(?:i(?:'ll|\s+will|\s+am\s+gonna|\s+gonna|'?m\s+gonna)|gonna|going\s+to)\s+(?:rape|sexually\s+assault|molest)\s+(?:you|u|her|him|them)\b/i,
    // General rape/molestation threat without subject
    /\b(?:rape|molest)\s+(?:you|u|her|him|them)\b/i,
    // "I know where you live" / "I found your address/IP"
    /\bi\s+(?:know|found)\s+(?:where\s+you\s+live|your\s+(?:address|location|ip(?:\s+address)?))\b/i,
    // Dox / Doxx references
    /\b(?:dox|doxx)(?:x(?:ing|ed)?|ing|ed)?\b/i,
    // Swat / Swatting references
    /\bswatt?(?:ing|ed)?\b/i,
    // "I will find you"
    /\bi(?:'ll|\s+will|\s+am\s+going\s+to)\s+(?:find|track\s+down|hunt\s+down)\s+(?:you|u)\b/i,
    // Blackmail: "I'll leak your", "I'll expose you", "pay me or I'll"
    /\bi(?:'ll|\s+will|\s+am\s+going\s+to)\s+(?:leak|expose|post|share)\s+(?:your|the)\b/i,
    /\bpay\s+(?:me|up)\s+or\s+(?:i'll|i\s+will|i\s+(?:swear|promise))\b/i,
    /\bi\s+have\s+(?:your|the)\s+(?:nudes?|photos?|pics?|screenshots?|address|info|location)\b/i,
];


const SELF_HARM_PATTERNS: RegExp[] = [
    // kys / k y s / k.y.s — and the veiled "keep yourself safe" plausible-deniability variant
    /\bk+\s*[y]+\s*s+\b/i,
    /\bkeep\s+(?:your|ur)\s*self\s+safe\b/i,
    // kms / k m s — "kill myself", less commonly actioned than kys but still reportable
    /\bk+\s*m+\s*s+\b/i,
    /\bkill\s+(?:my|m[ye])\s*self\b/i,
    // "kill yourself" / "kill urself"
    /\bkill\s+(?:your|ur)\s*self\b/i,
    // "neck yourself" / "go neck"
    /\bneck\s+(?:your|ur)\s*self\b/i,
    /\bgo\s+neck\b/i,
    // "rope yourself" / "go rope" / "touch rope"
    /\b(?:go\s+)?rope\s+(?:your|ur)\s*self\b/i,
    /\btouch\s+rope\b/i,
    // "end yourself" / "end it all"
    /\bend\s+(?:your|ur)\s*self\b/i,
    /\bend\s+it\s+all\b/i,
    // "off yourself"
    /\boff\s+(?:your|ur)\s*self\b/i,
    // "unalive yourself" (TikTok-era euphemism, still reportable)
    /\bunalive\s+(?:your|ur)\s*self\b/i,
    // "drink bleach" / "drink clorox"
    /\bdrink\s+(?:bleach|clorox|acid)\b/i,
    // "go die" / "just die"
    /\b(?:go|just|please)\s+die\b/i,
    // "slit your wrists"
    /\bslit\s+(?:your|ur)\s+wrists\b/i,
    // "hang yourself"
    /\bhang\s+(?:your|ur)\s*self\b/i,
    // "shoot yourself"
    /\bshoot\s+(?:your|ur)\s*self\b/i,
    // "do everyone a favor and [die/etc]"
    /\bdo\s+(?:everyone|us\s+all?)\s+a\s+favor\s+and\s+(?:die|kys|kill\s+(?:your|ur)self)\b/i,
];


const GROOMING_PATTERNS: RegExp[] = [
    // "don't tell anyone" / "don't tell your parents/mom/dad"
    /\bdon'?t\s+tell\s+(?:anyone|anybody|your\s+(?:parents?|mom|mum|dad|friends?|anyone))\b/i,
    // "our little secret" / "keep this a secret" / "keep this between us"
    /\b(?:our\s+(?:little\s+)?secret|keep\s+this\s+(?:a\s+secret|between\s+us|private|quiet)|this\s+is\s+(?:our\s+)?secret)\b/i,
    // "are you alone" / "is anyone home" / "is anyone with you"
    /\b(?:are\s+you\s+alone|is\s+anyone\s+(?:home|there|with\s+you)|are\s+your\s+parents\s+(?:home|there|around))\b/i,
    // "don't tell [adults]" catch-all
    /\bdon'?t\s+(?:let|tell)\s+(?:your\s+)?(?:parents?|adults?|mom|dad|mum|family)\s+(?:know|find out|see)\b/i,
    // "just between us" / "between you and me"
    /\b(?:just\s+between\s+(?:us|you\s+and\s+me)|between\s+you\s+and\s+me)\b/i,
];


const SOLICITATION_PATTERNS: RegExp[] = [
    // "send nudes" / "send me nudes" / "nudes?"
    /\bsend\s+(?:me\s+)?(?:nudes?|naked\s+pics?|naked\s+photos?)\b/i,
    /\bnudes?\s*\?/i,
    // "send pics" / "send me pics" in a sexual context (paired with other signals)
    /\bsend\s+(?:me\s+)?(?:body\s+)?(?:pics?|photos?|snaps?)\s+(?:of\s+(?:your|ur)\s+(?:body|tits?|ass|dick|cock|pussy))/i,
    // "feet pics" / "feet photos"
    /\bfeet\s+(?:pics?|photos?|content)\b/i,
    // "show me on cam" / "get on cam" / "get on vc and [sexual act]"
    /\b(?:get\s+on|show\s+me\s+on|hop\s+on)\s+(?:cam|camera)\b/i,
    // Explicit sexual requests directed at a person
    /\b(?:send|show)\s+(?:me\s+)?(?:your\s+)?(?:tits?|ass|dick|cock|pussy|boobs?)\b/i,
];


const RAID_PATTERNS: RegExp[] = [
    // "raid [server/discord/channel]" / "let's raid" / "we're raiding"
    /\b(?:let'?s\s+|we'?re\s+|going\s+to\s+|gonna\s+)?raid\s+(?:the\s+)?(?:server|discord|channel|guild|them|it)\b/i,
    /\braiding\s+(?:the\s+)?(?:server|discord|channel|guild|them|it)\b/i,
    // "spam [channel]" in coordination context
    /\bspam\s+(?:the\s+)?(?:channel|server|chat|discord|general|vc)\b/i,
    // Mass ping organising
    /\bmass\s+(?:ping|mention|dm)\b/i,
    // "grief [server]"
    /\bgrief(?:ing)?\s+(?:the\s+)?(?:server|discord|channel|guild)\b/i,
];

// ─── Risk Checker ─────────────────────────────────────────────────────────────

interface Risk {
    category: string;
    detail: string;
}

function checkRisks(content: string): Risk[] {
    const risks: Risk[] = [];
    const { checkAmbiguous, checkAge, checkSlurs, checkThreats, checkSelfHarm, checkGrooming, checkSolicitation, checkRaiding, customWords } = settings.store;
    const trimmed = content.trim();

    if (checkAmbiguous && (AMBIGUOUS_SINGLE.test(trimmed) || AMBIGUOUS_PHRASES.some(p => p.test(trimmed)))) {
        risks.push({
            category: "Ambiguous Message",
            detail: "Short responses with no surrounding context (\"yes i am\", \"no\", \"sure\") can be screenshotted and used in a false report — they read as a confirmation of anything.",
        });
    }

    if (checkAge) {
        for (const pattern of AGE_PATTERNS) {
            if (pattern.test(trimmed)) {
                risks.push({
                    category: "Age Reference",
                    detail: "Your message appears to state or imply an age under 18. This is a red flag for reports in most server contexts and can be misrepresented easily.",
                });
                break;
            }
        }
    }

    if (checkSlurs) {
        for (const pattern of SLUR_PATTERNS) {
            if (pattern.test(content)) {
                risks.push({
                    category: "Slur / Hate Speech",
                    detail: "Your message contains a slur or hateful term. Even used casually between friends, a single report is often enough for Discord to issue a permanent ban without appeal.",
                });
                break;
            }
        }
    }

    if (checkThreats) {
        for (const pattern of THREAT_PATTERNS) {
            if (pattern.test(content)) {
                risks.push({
                    category: "Threatening Language",
                    detail: "Your message contains language that could be read as a threat, or references to doxxing/swatting. Discord has zero tolerance for this, including jokes.",
                });
                break;
            }
        }
    }

    if (checkSelfHarm) {
        for (const pattern of SELF_HARM_PATTERNS) {
            if (pattern.test(content)) {
                risks.push({
                    category: "Self-Harm Encouragement",
                    detail: "Your message directs someone to harm themselves. This is one of the most frequently reported categories on Discord and results in near-immediate bans.",
                });
                break;
            }
        }
    }

    if (checkGrooming) {
        for (const pattern of GROOMING_PATTERNS) {
            if (pattern.test(content)) {
                risks.push({
                    category: "Grooming Language",
                    detail: "Your message contains a phrase commonly associated with grooming (e.g. 'don\'t tell anyone', 'our little secret'). Discord flags these heavily, especially in servers with younger audiences.",
                });
                break;
            }
        }
    }

    if (checkSolicitation) {
        for (const pattern of SOLICITATION_PATTERNS) {
            if (pattern.test(content)) {
                risks.push({
                    category: "Explicit Solicitation",
                    detail: "Your message requests nude or sexual content. This is a bannable offence regardless of context, and Discord\'s trust & safety team acts on these quickly.",
                });
                break;
            }
        }
    }

    if (checkRaiding) {
        for (const pattern of RAID_PATTERNS) {
            if (pattern.test(content)) {
                risks.push({
                    category: "Raid / Spam Coordination",
                    detail: "Your message contains language associated with server raiding or spam coordination. Discord bans accounts involved in raids, including organisers.",
                });
                break;
            }
        }
    }

    if (customWords) {
        const terms = customWords.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
        for (const term of terms) {
            if (content.toLowerCase().includes(term)) {
                risks.push({
                    category: "Custom Flagged Term",
                    detail: `Your message contains a term you've flagged as risky: "${term}"`,
                });
            }
        }
    }

    return risks;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

const categoryColors: Record<string, string> = {
    "Ambiguous Message":        "var(--status-warning)",
    "Age Reference":            "var(--text-feedback-critical)",
    "Slur / Hate Speech":       "var(--text-feedback-critical)",
    "Threatening Language":     "var(--text-feedback-critical)",
    "Self-Harm Encouragement":  "var(--text-feedback-critical)",
    "Grooming Language":        "var(--text-feedback-critical)",
    "Explicit Solicitation":    "var(--text-feedback-critical)",
    "Raid / Spam Coordination": "var(--status-warning)",
    "Custom Flagged Term":      "var(--status-warning)",
};

function RiskModal({ modalProps, risks, onAccept, onCancel }: {
    modalProps: any;
    risks: Risk[];
    onAccept(): void;
    onCancel(): void;
}) {
    function handleClose() {
        modalProps.onClose();
        onCancel();
    }

    return (
        <ModalRoot {...modalProps} size="small">
            <ModalHeader separator={false} style={{ display: "flex", alignItems: "center" }}>
                <Forms.FormTitle
                    tag="h2"
                    style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, flex: 1 }}
                >
                    <span style={{ fontSize: "1.2em" }}>⚠️</span>
                    Risky Message Detected
                </Forms.FormTitle>
                <ModalCloseButton onClick={handleClose} style={{ marginLeft: "auto" }} />
            </ModalHeader>

            <ModalContent style={{ padding: "12px 16px 0" }}>
                <Forms.FormText style={{ marginBottom: 12, color: "var(--text-muted)" }}>
                    Sending this message could put your account at risk. Review the issue{risks.length > 1 ? "s" : ""} below before proceeding:
                </Forms.FormText>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                    {risks.map((risk, i) => {
                        const color = categoryColors[risk.category] ?? "var(--status-warning)";
                        return (
                            <div
                                key={i}
                                style={{
                                    background: "var(--background-secondary)",
                                    borderRadius: 8,
                                    padding: "10px 14px",
                                    borderLeft: `3px solid ${color}`,
                                }}
                            >
                                <Forms.FormTitle
                                    tag="h5"
                                    style={{ margin: "0 0 4px 0", color, fontSize: "0.85em", textTransform: "uppercase", letterSpacing: "0.05em" }}
                                >
                                    {risk.category}
                                </Forms.FormTitle>
                                <Forms.FormText style={{ margin: 0, fontSize: "0.95em" }}>
                                    {risk.detail}
                                </Forms.FormText>
                            </div>
                        );
                    })}
                </div>
            </ModalContent>

            <ModalFooter style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <Button
                    color={Button.Colors.PRIMARY}
                    look={Button.Looks.OUTLINED}
                    onClick={handleClose}
                    style={{ marginLeft: 16 }}
                >
                    Go Back
                </Button>
                <Button
                    color={Button.Colors.RED}
                    onClick={() => { modalProps.onClose(); onAccept(); }}
                >
                    Accept the Risk
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}


// ─── Context Menu ─────────────────────────────────────────────────────────────

function getWhitelist(): string[] {
    return (settings.store.whitelistedChannels || "")
        .split(",")
        .map((id: string) => id.trim())
        .filter(Boolean);
}

function setWhitelist(ids: string[]) {
    settings.store.whitelistedChannels = ids.join(", ");
}

const ShieldIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 14l-3-3 1.41-1.41L11 12.17l4.59-4.58L17 9l-6 6z"/>
    </svg>
);

function patchContextMenu(children: any[], props: any) {
    // channel-context / gdm-context → props.channel is populated directly
    // user-context (DM list) → need to resolve channel from user ID
    const channelId = props.channel?.id ?? DMChannelStore.getDMFromUserId(props.user?.id);
    if (!channelId) return;

    const whitelist = getWhitelist();
    const isWhitelisted = whitelist.includes(channelId);

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="safeguard-whitelist-toggle"
                label={isWhitelisted ? "Remove from SafeGuard Whitelist" : "Whitelist in SafeGuard"}
                icon={ShieldIcon}
                action={() => {
                    if (isWhitelisted) {
                        setWhitelist(whitelist.filter(id => id !== channelId));
                    } else {
                        setWhitelist([...whitelist, channelId]);
                    }
                }}
                color={isWhitelisted ? "danger" : "default"}
            />
        </Menu.MenuGroup>
    );
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "SafeGuard",
    description: "Warns you before sending messages that could get your account banned — slurs, ambiguous responses, age references, threats, and custom terms.",
    tags: ["Safety", "Chat", "Utility"],
    authors: [{ name: "ren", id: 163734654040539136n }],

    settings,

    start() {
        addContextMenuPatch("channel-context", patchContextMenu);
        addContextMenuPatch("gdm-context", patchContextMenu);
        addContextMenuPatch("user-context", patchContextMenu);
    },

    stop() {
        removeContextMenuPatch("channel-context", patchContextMenu);
        removeContextMenuPatch("gdm-context", patchContextMenu);
        removeContextMenuPatch("user-context", patchContextMenu);
    },

    onBeforeMessageSend(channelId: string, msg: any) {
        // Let re-sent messages (after user accepted risk) pass through
        if (bypassNext) {
            bypassNext = false;
            return;
        }

        // Skip whitelisted channels
        const whitelisted = settings.store.whitelistedChannels
            .split(",")
            .map((id: string) => id.trim())
            .filter(Boolean);

        if (whitelisted.includes(channelId)) return;

        const risks = checkRisks(msg.content);
        if (risks.length === 0) return;

        openModal(props => (
            <RiskModal
                modalProps={props}
                risks={risks}
                onAccept={() => {
                    bypassNext = true;
                    const inp = document.querySelector("[data-slate-editor=\"true\"]");
                    if (inp instanceof HTMLElement) {
                        inp.focus();
                        inp.dispatchEvent(new KeyboardEvent("keydown", {
                            key: "Enter",
                            code: "Enter",
                            keyCode: 13,
                            bubbles: true,
                            cancelable: true,
                        }));
                    } else {
                        // Fallback: composer not found, go via API
                        MessageActions.sendMessage(channelId, msg);
                    }
                }}
                onCancel={() => { }}
            />
        ));

        return { cancel: true };
    },
});
