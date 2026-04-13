# Logic

## What it is

Logic is the study of valid reasoning — the rules that govern when a conclusion follows from premises, and when it does not. It is both a formal discipline (symbolic systems with precise syntax and semantics) and a practical skill (the ability to think clearly, spot errors, and construct sound arguments).


## Core concepts

### Propositional logic
The logic of simple statements and their connections. Propositions are statements that are either true or false. They are combined with connectives: AND (conjunction), OR (disjunction), NOT (negation), IF...THEN (conditional), IF AND ONLY IF (biconditional). Propositional logic is the foundation — the simplest formal system that captures the structure of reasoning.

### Predicate logic
An extension of propositional logic that adds internal structure to propositions. "Socrates is mortal" is a single proposition in propositional logic. In predicate logic, it becomes: Mortal(Socrates) — a predicate applied to a subject. Predicate logic also introduces quantifiers: FOR ALL (universal) and THERE EXISTS (existential). "All humans are mortal" becomes: for all x, if Human(x) then Mortal(x). This allows logic to handle generality — to reason about categories, not just individuals.

### Syllogisms
Aristotle's contribution: structured arguments with two premises and a conclusion. "All men are mortal. Socrates is a man. Therefore, Socrates is mortal." The valid forms of syllogism were catalogued by Aristotle and refined by medieval logicians. Syllogistic logic is limited compared to predicate logic but remains the most intuitive form of logical reasoning.

### Validity vs soundness
A valid argument has a structure such that if the premises are true, the conclusion must be true. A sound argument is valid and has true premises. You can have a valid argument with false premises and a false conclusion. You can have an invalid argument with true premises and a true conclusion. Validity is about structure, not truth. Soundness is about both. This distinction is fundamental and widely misunderstood.

### Deduction vs induction vs abduction
Three modes of reasoning:

**Deduction** — from general rules to specific conclusions. If all A are B, and this is an A, then this is a B. Deduction is truth-preserving: if the premises are true, the conclusion must be true. The price is that deduction never tells you anything genuinely new — the conclusion is already contained in the premises.

**Induction** — from specific observations to general rules. Every swan I have seen is white; therefore all swans are white. Induction is ampliative: the conclusion goes beyond the premises. The price is that induction is never certain. The next swan might be black.

**Abduction** — inference to the best explanation. The lawn is wet. The best explanation is that it rained. Abduction is how most everyday reasoning works and how most scientific hypotheses are generated. It is neither deductive nor inductive but a creative leap to the most plausible explanation.

### Modus ponens
The most basic valid argument form. If P then Q. P. Therefore Q. "If it is raining, the ground is wet. It is raining. Therefore the ground is wet." Simple, undeniable, and the engine of deductive reasoning.

### Modus tollens
The contrapositive of modus ponens. If P then Q. Not Q. Therefore not P. "If it is raining, the ground is wet. The ground is not wet. Therefore it is not raining." This is the logical form of falsification — the backbone of Popper's philosophy of science. If a theory predicts X, and X does not occur, the theory is wrong.

### Reductio ad absurdum
Proof by contradiction. Assume the opposite of what you want to prove. Show that this assumption leads to a contradiction. Conclude that the assumption is false and therefore the original claim is true. One of the most powerful proof techniques in mathematics and one of the most useful argument strategies in practice.

### Conditional reasoning
Reasoning about if-then statements. The source of more errors than any other logical form. People confuse "if P then Q" with "if Q then P" (affirming the consequent). They confuse "if P then Q" with "if not-P then not-Q" (denying the antecedent). Both are invalid. Only modus ponens and modus tollens are valid for conditionals.

### Necessary vs sufficient conditions
A necessary condition must be present for something to occur but does not guarantee it. Oxygen is necessary for fire but not sufficient. A sufficient condition guarantees an occurrence but is not the only way. Decapitation is sufficient for death but not necessary. Confusing necessary and sufficient conditions is one of the most common reasoning errors.

### Logical fallacies — formal

**Affirming the consequent** — If P then Q. Q. Therefore P. Invalid. "If it rained, the ground is wet. The ground is wet. Therefore it rained." But the sprinkler could have run.

**Denying the antecedent** — If P then Q. Not P. Therefore not Q. Invalid. "If it rained, the ground is wet. It didn't rain. Therefore the ground is not wet." But the sprinkler again.

**Undistributed middle** — All A are B. All C are B. Therefore all A are C. Invalid. "All dogs are animals. All cats are animals. Therefore all dogs are cats."

**Illicit major/minor** — Syllogistic errors where a term is distributed in the conclusion but not in the premises.

### Logical fallacies — informal

**Ad hominem** — Attacking the person making the argument rather than the argument itself. The character of the arguer is irrelevant to the validity of the argument.

**Straw man** — Misrepresenting an opponent's position to make it easier to attack. Defeating the straw man proves nothing about the real position.

**Appeal to authority** — Using an authority's endorsement as evidence. Authorities can be wrong. Their expertise increases the probability but does not guarantee truth.

**False dilemma** — Presenting two options as if they were exhaustive when other options exist. "You're either with us or against us."

**Slippery slope** — Arguing that a small step will inevitably lead to extreme consequences without establishing the causal chain.

**Begging the question** — Assuming the conclusion in the premises. Circular reasoning disguised as argument.

**Tu quoque** — "You do it too." The fact that your critic is inconsistent does not make your position correct.

**Equivocation** — Using a word with multiple meanings in different parts of an argument, as if it had one meaning throughout.

**Appeal to nature** — Arguing that what is natural is good and what is unnatural is bad. Nature includes parasites, disease, and infanticide.

**Composition and division** — Assuming that what is true of parts is true of the whole (composition), or that what is true of the whole is true of the parts (division).

### The liar's paradox
"This sentence is false." If it is true, then it is false. If it is false, then it is true. The paradox has resisted resolution for over two thousand years and led to fundamental developments in logic, including Tarski's theory of truth and the hierarchy of languages. It demonstrates that self-reference creates problems that logic alone cannot resolve.

### Godel's incompleteness theorems
The most important results in mathematical logic. The first theorem: any consistent formal system powerful enough to express arithmetic contains statements that are true but cannot be proved within the system. The second theorem: such a system cannot prove its own consistency. These theorems establish fundamental limits on formal reasoning — there will always be truths that escape any given logical system. This is not a flaw to be fixed but a structural feature of logic itself.

### Tarski's undefinability theorem
Truth for a formal language cannot be defined within that language. You need a metalanguage to talk about truth in the object language. This is related to the liar's paradox — self-referential truth claims create contradictions. Tarski's solution: hierarchies of languages, each capable of expressing truth about the one below.

### Modal logic
Logic extended to include necessity and possibility. "It is necessary that P" (P is true in all possible worlds). "It is possible that P" (P is true in at least one possible world). Modal logic formalises reasoning about what must be, what could be, and what cannot be. Extensions include epistemic logic (knowledge and belief), deontic logic (obligation and permission), and temporal logic (always, sometimes, until).

### Decision procedures
A decision procedure is an algorithm that determines, in finite time, whether a given statement in a formal system is valid. Propositional logic has a decision procedure (truth tables). Predicate logic does not — Church and Turing proved that validity in predicate logic is undecidable. This means there is no general algorithm for determining whether an arbitrary logical statement is true. Some questions cannot be settled mechanically.

### Boolean algebra
George Boole's algebraisation of logic. Logical operations (AND, OR, NOT) correspond to algebraic operations on sets (intersection, union, complement). This correspondence — logic as algebra — made it possible to calculate with propositions and ultimately led to digital computing. Every computer is a Boolean algebra engine.

### The Turing machine
Alan Turing's abstract model of computation. A simple machine that reads and writes symbols on a tape according to rules. Turing showed that any computation can be performed by such a machine — and that some problems cannot be computed by any machine (the halting problem). The Turing machine connects logic to computation and establishes the limits of what can be decided mechanically.

### Proof theory
The study of proofs as mathematical objects. What makes a proof valid? How long must a proof be? Are there short proofs for all true statements? Proof theory connects logic to computational complexity — the length and difficulty of proofs mirror the difficulty of computation.

### Formal vs informal logic
Formal logic deals with abstract structures: validity, derivation, truth conditions. Informal logic deals with real-world argumentation: persuasion, relevance, burden of proof, argument strength. Formal logic is precise but narrow. Informal logic is broad but messy. Both are needed.


## Key thinkers

**Aristotle** (384-322 BCE) — Greek philosopher who invented logic as a formal discipline. His Prior Analytics catalogued the valid forms of syllogism and established the study of deductive reasoning. For over two thousand years, logic meant Aristotelian logic. His work remains the foundation, even though modern logic has far surpassed it.

**Chrysippus** (c. 279-206 BCE) — Stoic philosopher who developed propositional logic independently of Aristotle's term logic. Formulated the basic argument forms (modus ponens, modus tollens, disjunctive syllogism) and the Stoic theory of conditionals. His contributions were underappreciated for centuries but anticipated modern propositional logic.

**George Boole** (1815-1864) — English mathematician who created Boolean algebra, showing that logical operations could be expressed algebraically. The Laws of Thought (1854) transformed logic from a branch of philosophy into a branch of mathematics. His work made digital computing possible.

**Gottlob Frege** (1848-1925) — German mathematician and philosopher who invented predicate logic in his Begriffsschrift (1879). Created a formal language powerful enough to express all mathematical reasoning. His work was the foundation for modern logic, analytic philosophy, and the philosophy of language. Frege's logic replaced Aristotle's as the standard.

**Bertrand Russell** (1872-1970) — British philosopher and mathematician who (with Whitehead) attempted to derive all of mathematics from logic in Principia Mathematica. Discovered Russell's paradox (the set of all sets that do not contain themselves). His work on types, descriptions, and logical atomism shaped analytic philosophy.

**Kurt Godel** (1906-1978) — Austrian-American logician who proved the incompleteness theorems (1931), showing that any sufficiently powerful formal system contains truths it cannot prove. The most profound result in the history of logic. It established permanent limits on the power of formal reasoning and shattered the programme of Hilbert to prove mathematics complete and consistent.

**Alfred Tarski** (1901-1983) — Polish-American logician who developed the semantic theory of truth and proved the undefinability theorem. His work on model theory provided the mathematical foundations for the semantics of formal languages. Showed how to make rigorous sense of "truth" in formal systems.

**Alan Turing** (1912-1954) — British mathematician who defined computation, proved the undecidability of the halting problem, and established the theoretical foundations of computer science. His work connects logic directly to computation: what can be computed is what can be decided by a formal procedure.


## Connections

**Probability** — Probability extends logic from certainty to uncertainty. Where logic says "if P then Q," probability says "if P then Q with probability 0.8." Cox's theorem shows that any system of uncertain reasoning consistent with logic must obey the probability axioms. Logic is the special case of probability where all probabilities are 0 or 1.

**Rationalism** — Logic is the formal backbone of rationalism. Rationalist thinking depends on valid inference, detection of fallacies, and the ability to follow an argument to its conclusion. The rationalist community uses logical structure implicitly in every argument about biases, updating, and beliefs.

**Empiricism** — Logic provides the deductive structure within which empirical reasoning operates. Falsification is modus tollens applied to scientific theories. The hypothetico-deductive method combines logical deduction with empirical testing. Empiricism uses logic; logic alone cannot produce empirical knowledge.

**Epistemology** — Epistemic logic formalises knowledge and belief. Logic is essential to epistemology's analysis of justification: what follows from what you know? The regress problem, closure principles, and Gettier cases all involve logical structure. Epistemology asks what we know; logic asks what follows from what we know.

**Stoicism** — The Stoics were logicians. Chrysippus developed propositional logic and the theory of conditionals. Stoic logic was practical: it served the discipline of assent (only assenting to clear impressions) and the analysis of arguments. The Stoic sage is, among other things, a perfect logician.

**Ethics** — Logic applies to moral reasoning: the structure of moral arguments can be valid or invalid regardless of moral content. "All killing is wrong. This is a killing. Therefore this is wrong." The logic is valid; the question is whether the premises are true. Logic cannot generate moral conclusions from non-moral premises (Hume's is-ought gap), but it can evaluate the structure of moral arguments.

**Decision-making** — Decision trees are logical structures. The analysis of options, consequences, and conditions uses logical operators. "If A and B, then choose X; if A and not-B, then choose Y." Good decisions require clear logical structure — and the recognition of when the structure breaks down.

**Emotional intelligence** — Logic and emotion are traditionally opposed, but understanding emotions requires logical clarity about what you are feeling and why. "I am angry because X" is a causal claim that can be logically examined. Emotional intelligence includes the ability to reason clearly about emotional states.

**Algebra** — Logic and algebra are deeply intertwined. Boolean algebra is both logical and algebraic. Algebraic logic studies logical systems using algebraic methods. The connections run both ways: algebraic structures illuminate logical systems, and logical structures illuminate algebraic ones. Boole's insight — that logic is a species of algebra — was one of the most consequential in intellectual history.
