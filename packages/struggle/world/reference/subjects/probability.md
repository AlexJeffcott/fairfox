# Probability

## What it is

Probability is the discipline of reasoning under uncertainty — the formal and informal art of making decisions when you do not and cannot know everything. It is not merely a branch of mathematics. It is the foundation of rational action in a world where certainty is rare and information is always incomplete.


## Core concepts

### Bayesian reasoning
The process of updating beliefs in light of new evidence. You start with a prior (what you believed before), encounter evidence, and arrive at a posterior (what you believe now). The strength of the update depends on how much the evidence discriminates between hypotheses. This is the engine of learning.

### Bayes' theorem
P(H|E) = P(E|H) * P(H) / P(E). The mathematical expression of belief updating. The posterior probability of a hypothesis given evidence equals the likelihood of the evidence given the hypothesis, times the prior probability of the hypothesis, divided by the total probability of the evidence. Simple to state, difficult to internalise, and the single most important equation in reasoning.

### Base rates
The background frequency of an event before any specific evidence is considered. Most errors in probabilistic reasoning come from ignoring base rates — judging that something is likely because it fits a pattern, without asking how common the pattern is in the first place. The taxi-cab problem. The disease test problem. The prosecutor's fallacy.

### Prior probability
What you believe before seeing new evidence. Priors can be informative (based on real knowledge) or uninformative (deliberately vague to avoid bias). The choice of prior matters enormously when evidence is scarce and matters less as evidence accumulates.

### Expected value
The probability-weighted average of all possible outcomes. A gamble that pays 100 with probability 0.1 and 0 with probability 0.9 has an expected value of 10. Expected value guides decisions when you can play the game many times. When you can only play once, it may not be enough — you need to consider variance, ruin, and utility.

### Risk vs uncertainty
Frank Knight's distinction. Risk is when you know the probability distribution — you know the odds, even if you don't know the outcome. Uncertainty is when you don't even know the odds. Most real decisions involve uncertainty, not risk.

### Calibration
The skill of having your confidence levels match reality. If you say you are 80% confident about a hundred things, you should be right about eighty of them. Most people are overconfident — they say 90% when they mean 70%. Calibration is trainable. It is one of the few metacognitive skills that reliably improves with practice.

### Conditional probability
The probability of A given that B has occurred. P(A|B). The foundation of Bayesian reasoning and the source of most intuitive errors. People confuse P(A|B) with P(B|A) constantly — the probability of having the disease given a positive test is not the same as the probability of a positive test given the disease.

### The law of large numbers
Over many trials, the observed frequency of an event converges on its true probability. This is why casinos always win and individual gamblers sometimes do. It is also why a single observation tells you almost nothing about the underlying distribution.

### The gambler's fallacy
The belief that past random events affect future random events. The roulette wheel has no memory. If you have flipped ten heads in a row, the probability of the next flip being heads is still 0.5. The complementary error — the hot hand fallacy — is believing that streaks will continue. Both are failures to understand independence.

### Frequentist vs Bayesian interpretations
Frequentism defines probability as the long-run frequency of events. It answers: "If we repeated this experiment infinitely, how often would this outcome occur?" Bayesianism defines probability as a degree of belief. It answers: "Given what I know, how confident should I be?" The Bayesian interpretation is more flexible and more useful for one-off decisions, but frequentist methods dominate classical statistics for good historical reasons.

### The conjunction fallacy
The probability of A and B together can never exceed the probability of A alone. Yet people routinely judge specific, detailed scenarios as more likely than general ones, because the details make the story feel more plausible. Linda the bank teller.

### Regression to the mean
Extreme observations tend to be followed by less extreme ones, purely as a statistical phenomenon. This is not a force — nothing is "pulling" things back to the mean. It is simply that extreme observations are more likely to have been partly caused by luck, and luck does not persist.

### The problem of small samples
Small samples are noisy. They produce extreme results. The smallest hospitals have both the highest and lowest surgery success rates. The smallest schools have both the best and worst test scores. People see patterns in small samples that do not exist.

### Prediction markets
Markets where participants trade contracts that pay out based on whether events occur. Prediction markets aggregate dispersed information and tend to produce well-calibrated probability estimates. They work because people with better information have incentives to bet, and because the market price reflects the crowd's probability estimate.

### The Kelly criterion
A formula for optimal bet sizing given your edge and bankroll. Bet too little and you leave money on the table. Bet too much and you risk ruin. The Kelly criterion maximises the expected logarithm of wealth — which means it maximises long-term growth rate while avoiding bankruptcy.

### Fat tails and black swans
Not all distributions are Gaussian. Some events are far more extreme than a normal distribution would predict. Financial crashes, pandemics, earthquakes. The world has fat tails. Models that assume thin tails systematically underestimate the probability of catastrophe. Taleb's central insight.

### The Monte Carlo method
Using random sampling to estimate quantities that are hard to compute analytically. Generate thousands of scenarios, see what fraction satisfy your criteria. The computational equivalent of "let's just try it many times and see what happens."

### Information entropy
Shannon's measure of uncertainty. The more uncertain you are, the more information you need to resolve the uncertainty. A coin flip has one bit of entropy. A die roll has about 2.6 bits. Entropy quantifies how much you don't know.


## Key thinkers

**Thomas Bayes** (1702-1761) — English minister who first formulated the theorem of inverse probability. His work was published posthumously and established the foundation for all Bayesian reasoning.

**Pierre-Simon Laplace** (1749-1827) — French mathematician who independently developed and greatly extended Bayesian reasoning. Formulated the principle of indifference and applied probability to astronomy, demography, and jurisprudence. Called probability "common sense reduced to calculus."

**Andrey Kolmogorov** (1903-1987) — Russian mathematician who axiomatised probability theory in 1933, placing it on rigorous mathematical foundations. His axioms unified the various approaches to probability and made modern probability theory possible.

**Daniel Kahneman** (1934-2024) and **Amos Tversky** (1937-1996) — Israeli-American psychologists who documented the systematic ways humans fail at probabilistic reasoning. Prospect theory, availability heuristic, anchoring, representativeness. Kahneman won the Nobel Prize in Economics. Their work is the empirical foundation of behavioural economics.

**Jacob Bernoulli** (1655-1705) — Swiss mathematician who proved the law of large numbers and wrote Ars Conjectandi, the first systematic treatment of probability. Introduced the concept of moral expectation (expected utility vs expected value).

**Blaise Pascal** (1623-1662) — French mathematician and philosopher. Co-founded probability theory through correspondence with Fermat about the problem of points. Also formulated Pascal's Wager — the first explicit use of expected value reasoning applied to a decision under uncertainty.

**Bruno de Finetti** (1906-1985) — Italian mathematician who developed the subjective interpretation of probability. "Probability does not exist" — meaning there is no objective probability, only degrees of belief. His exchangeability theorem provided the mathematical foundation for subjective Bayesianism.

**Edwin Thompson Jaynes** (1922-1998) — American physicist who developed maximum entropy methods and wrote Probability Theory: The Logic of Science, treating probability as an extension of logic rather than a branch of mathematics.

**Nassim Nicholas Taleb** (b. 1960) — Lebanese-American essayist and risk analyst. Popularised fat tails, black swans, antifragility, and the idea that our standard risk models systematically underestimate extreme events. His Incerto series is an extended meditation on uncertainty.

**Abraham de Moivre** (1667-1754) — French mathematician who discovered the normal distribution and developed the concept of standard deviation. Showed how probability could be applied to actuarial science.

**Frank Knight** (1885-1972) — American economist who distinguished between risk (quantifiable) and uncertainty (not quantifiable). This distinction remains one of the most important in decision theory.


## Connections

**Rationalism** — Probability is the quantitative backbone of rationalism. Bayesian reasoning is the formal method by which rationalists update beliefs. Calibration is a core rationalist practice. The rationalist community treats probability as the language of epistemics.

**Empiricism** — Probability provides the mathematical framework for interpreting empirical evidence. Statistical significance, confidence intervals, p-values, likelihood ratios — all are probabilistic tools for evaluating observations. Empiricism generates data; probability tells you what the data means.

**Epistemology** — Probability is a theory of knowledge under uncertainty. Bayesian epistemology treats degrees of belief as the fundamental epistemic unit. The question "what do you know?" becomes "what are your credences, and are they well-calibrated?"

**Logic** — Probability extends logic to degrees of truth. Where logic deals in certainties (valid or invalid), probability deals in likelihoods. Cox's theorem shows that any system of plausible reasoning consistent with logic must obey the rules of probability.

**Stoicism** — The Stoic practice of distinguishing what is in your control from what is not maps directly onto probability. You control your decisions; you do not control outcomes. Expected value reasoning is the mathematical expression of this distinction.

**Ethics** — Probabilistic reasoning is essential to consequentialist ethics. If outcomes are uncertain, moral evaluation requires expected value calculations over possible outcomes. Moral luck, risk imposition, and the precautionary principle all live at the intersection of probability and ethics.

**Decision-making** — Probability is the informational input to decision theory. Expected utility theory, prospect theory, and all decision frameworks require probability estimates as inputs. You cannot decide well if you estimate poorly.

**Emotional intelligence** — Calibration requires emotional regulation. Overconfidence is partly a cognitive bias and partly an emotional one — the feeling of certainty is seductive. Good probabilistic reasoning requires managing the discomfort of uncertainty.

**Algebra** — Probability theory uses algebraic structures extensively. Sigma-algebras, probability spaces, random variables as measurable functions. The combinatorics underlying probability (permutations, combinations) are algebraic in nature.
