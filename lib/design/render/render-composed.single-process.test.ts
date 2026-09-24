import { defineRealChromeSuite } from './real-chrome-suite'

// Local Chrome launched the way @sparticuz/chromium runs on Vercel
// (--single-process, --no-zygote) — the mode in which repeatedly creating and
// closing contexts/pages wedged newPage() (task-4-findings-gate-r3.md).
defineRealChromeSuite('--single-process --no-zygote', '--single-process --no-zygote')
