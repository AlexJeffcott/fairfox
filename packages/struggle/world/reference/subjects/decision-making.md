# Decision-Making

## What it is

Decision-making under uncertainty is the practical discipline of choosing well
when you cannot know the outcome. It draws on probability, psychology, economics,
and philosophy to understand how decisions should be made in theory, how they are
actually made in practice, and how to close the gap between the two.


## Core concepts

### Expected value

The probability-weighted average of all possible outcomes. If a coin flip pays
$100 on heads and $0 on tails, the expected value is $50. In principle, the
rational choice is the one with the highest expected value. In practice, this
breaks down when stakes are high, probabilities are uncertain, or outcomes
involve things that cannot be priced.

### Expected utility

Daniel Bernoulli's refinement: what matters is not the objective value of
outcomes but their subjective utility. A dollar is worth more to a poor person
than a rich one. Expected utility theory replaces expected value with expected
utility — the probability-weighted average of how much each outcome matters to
you. This explains risk aversion: the utility of doubling your wealth is less
than the disutility of losing it all.

### Risk aversion

The tendency to prefer a certain outcome over a gamble with equal or higher
expected value. Most people would rather have $50 for sure than a 50% chance of
$100. This is rational given diminishing marginal utility, but it varies
enormously across individuals and contexts. Risk aversion is adaptive in
environments where one bad outcome can be fatal.

### Loss aversion

Kahneman and Tversky's central finding: losses loom larger than gains. Losing
$100 feels roughly twice as bad as gaining $100 feels good. This asymmetry
distorts decision-making in predictable ways — people take irrational risks to
avoid losses and forgo rational risks to avoid potential losses. Loss aversion is
not the same as risk aversion, though the two interact.

### Prospect theory

Kahneman and Tversky's descriptive model of how people actually make decisions,
replacing expected utility theory as a model of real behaviour. Key features:
reference dependence (outcomes are evaluated relative to a reference point, not
in absolute terms), loss aversion, and probability weighting (people overweight
small probabilities and underweight large ones). Prospect theory explains
why people buy both lottery tickets and insurance.

### Risk vs uncertainty (Knight)

Frank Knight's crucial distinction. Risk applies when you can assign meaningful
probabilities to outcomes (rolling dice, drawing cards). Uncertainty applies
when you cannot — when the outcome space is unknown, the probabilities are
unknown, or the situation is genuinely unprecedented. Most important decisions
involve uncertainty, not risk. This means many formal decision-making tools
(which assume known probabilities) have limited applicability to the situations
that matter most.

### Minimax regret

A decision strategy for deep uncertainty: choose the option that minimises your
maximum possible regret. Instead of optimising for the best outcome, you protect
against the worst case of "I wish I had done X instead." This is conservative
but powerful when probabilities are unknown and the downside of a wrong choice
is severe.

### Satisficing vs maximising (Simon)

Herbert Simon's distinction between two decision strategies. Maximisers seek the
best possible option — they compare all alternatives exhaustively. Satisficers
set a threshold and choose the first option that meets it. Simon showed that
maximising is often computationally impossible in complex environments
(bounded rationality) and that satisficing frequently produces better outcomes
in practice, because the costs of searching for the optimum exceed the benefits
of finding it.

### Bounded rationality

Simon's insight that human decision-makers have limited cognitive resources,
limited information, and limited time. We cannot be perfectly rational — we
use heuristics, shortcuts, and approximations. This is not a flaw but an
adaptation to a world too complex for full analysis. The question is which
heuristics work well in which environments.

### Multi-criteria decision analysis

Most real decisions involve multiple objectives that trade off against each
other. A job might pay well but require relocation. A medical treatment might be
effective but have side effects. MCDA provides frameworks for weighing multiple
criteria explicitly, rather than relying on gut feelings that may
systematically misjudge trade-offs.

### Reversible vs irreversible decisions

Jeff Bezos's distinction (though the idea is older): Type 1 decisions are
irreversible — walk through the door and you can't come back. Type 2 decisions
are reversible — you can try something and undo it if it doesn't work. The
appropriate level of deliberation depends on which type you're facing. Many
people apply Type 1 caution to Type 2 decisions, wasting time and
opportunity.

### Optionality

The value of keeping options open. An option gives you the right but not the
obligation to do something in the future. Decisions that preserve optionality
are valuable under uncertainty because they allow you to benefit from new
information as it arrives. Taleb emphasises this: in uncertain environments,
you want to be positioned to benefit from surprises rather than to be
harmed by them.

### The value of information

Before deciding, ask: is there information I could get that would change my
decision? If so, how much would that information be worth? Sometimes the right
move is to delay the decision and gather more data. Sometimes the information
is too expensive or too slow to obtain. Knowing when to decide and when to
gather more information is itself a decision skill.

### Pre-mortems

Gary Klein's technique: before committing to a plan, imagine that it has
failed spectacularly, then work backwards to identify what went wrong. This
inverts the natural optimism bias that makes planning feel too easy. Pre-mortems
consistently improve decision quality by surfacing risks that planners overlook
because they are motivated to believe the plan will succeed.

### Decision journals

The practice of recording your decisions, your reasoning, and your confidence
level at the time of the decision, then reviewing later to see if the reasoning
was sound. This separates decision quality from outcome quality — a good
decision can produce a bad outcome, and vice versa. Over time, a decision
journal reveals systematic biases and calibration errors.

### The planning fallacy

The tendency to underestimate the time, cost, and risk of future actions while
overestimating their benefits. Kahneman and Tversky documented this extensively.
It is remarkably robust — even people who know about it fall prey to it. The
best corrective is reference class forecasting: don't ask "how long will this
take?" — ask "how long did similar things take in the past?"

### Base rate neglect

The tendency to ignore the general prevalence (base rate) of an event when
evaluating a specific case. A positive medical test feels alarming, but if the
disease is rare and the test has a false positive rate, the actual probability
of being sick might be low. Base rate neglect is one of the most consequential
cognitive errors in decision-making, and Bayesian reasoning is the corrective.

### Anchoring

The first number you encounter disproportionately influences your subsequent
judgement. An arbitrary starting point (the "anchor") biases estimation and
negotiation even when the anchor is obviously irrelevant. Tversky and Kahneman
showed that even experienced professionals are affected. Awareness helps, but
does not eliminate the effect.

### The sunk cost trap

The tendency to continue investing in a failing course of action because of what
you've already spent (time, money, effort). Sunk costs are irrecoverable and
should be irrelevant to future decisions — only future costs and benefits
matter. But psychologically, abandoning a sunk cost feels like admitting failure,
and loss aversion makes that painful. The result: people throw good resources
after bad.

### Heuristics and biases

Kahneman and Tversky's research programme: humans rely on cognitive shortcuts
(heuristics) that are useful in many contexts but produce systematic errors
(biases) in others. The availability heuristic, representativeness heuristic,
and anchoring-and-adjustment are the big three. Gigerenzer's counterpoint: in
the right environment, these heuristics outperform complex calculations because
they exploit the structure of the environment.

### Recognition-primed decision-making (Klein)

Gary Klein's model of how experts actually decide under time pressure. Rather
than comparing options analytically, experienced decision-makers recognise
patterns and mentally simulate a single course of action. If the simulation
works, they act. If not, they modify and re-simulate. This is fast, effective,
and completely different from the rational-choice model. It explains how
firefighters, surgeons, and soldiers make good decisions in seconds.

### Overconfidence

One of the most robust findings in decision science: people are systematically
overconfident in their judgements. When they say they are 90% sure, they are
right about 70-75% of the time. Overconfidence distorts risk assessment,
planning, and prediction. Calibration training — getting feedback on the
accuracy of your confidence — is the best-documented corrective.


## Key thinkers

**Blaise Pascal (1623-1662)** — Developed the foundations of probability theory
and decision theory simultaneously. Pascal's Wager is the first formal
decision-theoretic argument: even under uncertainty about God's existence, the
expected utility of belief dominates. More importantly, he established the idea
that rational action under uncertainty requires weighing probabilities and
payoffs.

**Daniel Bernoulli (1700-1782)** — Resolved the St. Petersburg paradox by
introducing the concept of diminishing marginal utility. Showed that rational
decision-making requires considering not just the objective value of outcomes but
their subjective worth to the decision-maker. This was the birth of expected
utility theory.

**John von Neumann (1903-1957)** — Co-created game theory and formalised expected
utility theory axiomatically (with Morgenstern). Provided the mathematical
foundations for rational decision-making under uncertainty. His influence on
decision theory, economics, and computer science is immeasurable.

**Oskar Morgenstern (1902-1977)** — Collaborated with von Neumann on Theory of
Games and Economic Behavior, which established game theory as a discipline and
provided the axiomatic foundation for expected utility theory.

**Leonard Savage (1917-1971)** — Extended expected utility theory to subjective
probability in The Foundations of Statistics. Savage's axioms define what it means
to be a rational decision-maker when probabilities are not objectively given —
which is most of the time.

**Herbert Simon (1916-2001)** — Introduced bounded rationality and satisficing.
Showed that real decision-makers cannot and should not try to be perfectly
rational — they should use heuristics adapted to their cognitive limits and
environmental structure. Won the Nobel Prize in Economics for this work.

**Daniel Kahneman (1934-2024)** — With Tversky, documented the systematic biases
in human judgement and developed prospect theory as a descriptive model of
decision-making. Thinking, Fast and Slow is the definitive popular account.
Nobel Prize in Economics (2002) for work that undermined the rational-agent
model of economics.

**Amos Tversky (1937-1996)** — Kahneman's collaborator and equal in the
heuristics-and-biases research programme. Tversky's work on similarity,
choice, and probability judgement was foundational. Died before the Nobel
Prize was awarded; Kahneman has consistently credited him as the greater mind.

**Gerd Gigerenzer (1947-)** — The chief critic of the heuristics-and-biases
programme. Argues that heuristics are not errors but ecological rationality —
strategies adapted to specific environments. His research shows that simple
heuristics (like "take the best cue") often outperform complex models in
real-world prediction. The debate between Gigerenzer and Kahneman is one of the
most productive in modern psychology.

**Gary Klein (1944-)** — Pioneered naturalistic decision-making, studying how
experts decide in high-stakes, time-pressured situations. His recognition-primed
decision model challenged the view that good decisions require deliberate
analysis. Klein and Kahneman later published a joint paper mapping when each
approach applies.

**Nassim Nicholas Taleb (1960-)** — Focused on decision-making in the presence of
extreme uncertainty and rare events (Black Swans). Emphasises optionality,
antifragility, and the limits of prediction. His work is polemical but
substantive: the core insight that most decision-making frameworks
underestimate tail risk is important and underappreciated.


## Connections

### Probability
Decision theory is built on probability theory. Expected value and expected
utility require probability estimates. Bayesian updating is the engine that
converts new information into better decisions. Prospect theory describes how
people distort probabilities. The entire edifice of rational decision-making
presupposes some ability to reason about likelihood.

### Rationalism
Formal decision theory is a rationalist project — it attempts to derive
optimal choices from axioms of rationality. Von Neumann-Morgenstern utility
theory and Savage's subjective expected utility are axiomatic systems.
Bounded rationality (Simon) is the empirical correction: the rationalist ideal
is unreachable, so we need to understand what rational-enough looks like.

### Empiricism
Kahneman and Tversky's programme is fundamentally empirical — it studies how
people actually decide, not how they should. Klein's naturalistic
decision-making is empirical observation of experts in the field. Gigerenzer's
ecological rationality grounds heuristic quality in empirical fit to
environmental structure. Decision science lives at the intersection of
normative theory and empirical reality.

### Epistemology
Every decision rests on beliefs about the world, and the quality of those
beliefs determines the quality of the decision. Base rate neglect is an
epistemological failure. The value of information is an epistemological concept.
Overconfidence is a calibration error about what you know. Decision-making
under uncertainty is, at bottom, acting on incomplete knowledge.

### Logic
Decision trees and game-theoretic analyses use logical structure to map out
possibilities and implications. Consistency requirements in expected utility
theory (transitivity, independence) are logical constraints on preference.
Minimax regret is a logical strategy for handling worst cases. Logic provides
the skeleton; probability and values flesh it out.

### Stoicism
The Stoic reserve clause ("fate willing") is a decision-making strategy: commit
to process, detach from outcome. Premeditatio malorum is a pre-mortem. The
dichotomy of control filters decision-relevant from decision-irrelevant
factors. Stoic equanimity enables clear thinking under pressure, which is the
precondition for any decision framework to work.

### Ethics
Ethics supplies the objective function for decisions. Without values, decision
theory is machinery without direction. The trolley problem is a decision under
ethical constraint. Moral uncertainty requires decision-making frameworks. The
demandingness problem is a question about how much weight moral considerations
should have in decisions relative to self-interest.

### Emotional intelligence
Emotions are data for decisions (Damasio's somatic markers) but also noise
(loss aversion, fear-driven anchoring). Emotional regulation is a prerequisite
for good decision-making under pressure. The Yerkes-Dodson curve describes the
relationship between arousal and decision quality. Too calm and you miss
urgency; too activated and you make impulsive errors.

### Algebra
Expected value is an algebraic operation: multiply and sum. Decision matrices
formalise trade-offs algebraically. Game theory is applied algebra to
strategic interaction. Linear programming optimises decisions under
constraints. The algebraic formalisation of decisions is what makes them
analysable — and also what makes it tempting to pretend that all decisions
can be formalised, which they cannot.
