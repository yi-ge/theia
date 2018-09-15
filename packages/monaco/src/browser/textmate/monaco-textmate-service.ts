/********************************************************************************
 * Copyright (C) 2018 Redhat, Ericsson and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { injectable, inject, named } from 'inversify';
import { Registry } from 'monaco-textmate';
import { ILogger, ContributionProvider } from '@theia/core';
import { FrontendApplicationContribution, isBasicWasmSupported } from '@theia/core/lib/browser';
import { LanguageGrammarDefinitionContribution, getEncodedLanguageId } from './textmate-contribution';
import { createTextmateTokenizer, TokenizerOption } from './textmate-tokenizer';
import { TextmateRegistry } from './textmate-registry';

export const OnigasmPromise = Symbol('OnigasmPromise');
export type OnigasmPromise = Promise<void>;

@injectable()
export class MonacoTextmateService implements FrontendApplicationContribution {

    protected grammarRegistry: Registry;

    @inject(ContributionProvider) @named(LanguageGrammarDefinitionContribution)
    protected readonly grammarProviders: ContributionProvider<LanguageGrammarDefinitionContribution>;

    @inject(TextmateRegistry)
    protected readonly textmateRegistry: TextmateRegistry;

    @inject(ILogger)
    protected readonly logger: ILogger;

    @inject(OnigasmPromise)
    protected readonly onigasmPromise: OnigasmPromise;

    initialize() {
        if (!isBasicWasmSupported) {
            console.log('Textmate support deactivated because WebAssembly is not detected.');
            return;
        }

        for (const grammarProvider of this.grammarProviders.getContributions()) {
            try {
                grammarProvider.registerTextmateLanguage(this.textmateRegistry);
            } catch (err) {
                console.error(err);
            }
        }

        this.grammarRegistry = new Registry({
            getGrammarDefinition: async (scopeName: string, dependentScope: string) => {
                const provider = this.textmateRegistry.getProvider(scopeName);
                if (provider) {
                    return await provider!.getGrammarDefinition(scopeName, dependentScope);
                }
                return {
                    format: 'json',
                    content: '{}'
                };

            }
        });

        const registered = new Set<string>();
        for (const { id } of monaco.languages.getLanguages()) {
            if (!registered.has(id)) {
                monaco.languages.onLanguage(id, () => this.activateLanguage(id));
                registered.add(id);
            }
        }
    }

    protected async activateLanguage(languageId: string) {
        const scopeName = this.textmateRegistry.getScope(languageId);
        if (!scopeName) {
            return;
        }
        const provider = this.textmateRegistry.getProvider(scopeName);
        if (!provider) {
            return;
        }

        const configuration = this.textmateRegistry.getGrammarConfiguration(languageId);
        const initialLanguage = getEncodedLanguageId(languageId);

        await this.onigasmPromise;
        try {
            const grammar = await this.grammarRegistry.loadGrammarWithConfiguration(scopeName, initialLanguage, configuration);
            const options = configuration.tokenizerOption ? configuration.tokenizerOption : TokenizerOption.DEFAULT;
            monaco.languages.setTokensProvider(languageId, createTextmateTokenizer(grammar, options));
        } catch (error) {
            this.logger.warn('No grammar for this language id', languageId, error);
        }
    }
}
