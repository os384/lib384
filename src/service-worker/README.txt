We build service-worker here in lib384 in order to yield as small
as possible final "service-worker.js" result, eg here we can
import / tree shake better.

The alternative is code duplication over to where os-loader is
built. Right now this approach is thought to be lesser of
two bad choices.

(Currently, building it locally here in lib384 yields a 26KB
file, but building it and pulling lib384 grows it to 290K)