import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { isAdmin } from '../events/interactionCreate.js';
import AiConfig, { type AIProviderType } from '../../../modules/ai/ai-config.model.js';
import AppSetting, { readSetting, type SettingKey } from '../../../modules/program/app-setting.model.js';
import ProgramConfig from '../../../modules/program/program-config.model.js';
import FeatureFlag from '../../../modules/program/feature-flag.model.js';
import { invalidateFeatureFlagCache, ensureFlag, FEATURE_FLAGS } from '../../../modules/program/feature-flag.controller.js';
import { invalidateProviderCache } from '../../../utils/ai/aiProvider.js';
import { invalidateProgramAppSettingsCache } from '../../../utils/program/appSettings.js';
import type { BotConfig } from '../discordBot.js';
import mongoose from 'mongoose';

export const adminConfigCommandData = new SlashCommandBuilder()
  .setName('admin-config')
  .setDescription('[admin] Manage backend settings, AI API keys, thresholds, and feature flags')
  .toJSON();

function errorEmbed(msg: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xff6b6b)
    .setTitle('⚠️ Admin Action Failed')
    .setDescription(msg.slice(0, 1000));
}

/** Build the settings overview Embed and Buttons */
export async function buildDashboard(batchId: string | null = null): Promise<{ embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] }> {
  let aiConfig = batchId ? await AiConfig.findOne({ batchId, isActive: true }) : null;
  if (!aiConfig) {
    aiConfig = await AiConfig.findOne({ batchId: null, isActive: true });
  }

  const providers: AIProviderType[] = ['anthropic', 'openai', 'xai', 'minimax', 'gemini', 'custom'];
  const keyStatus = providers.map(p => {
    const hasKey = aiConfig ? !!aiConfig.getApiKey(p) : false;
    const label = p.toUpperCase();
    return `${hasKey ? '✅' : '❌'} **${label}**`;
  }).join('\n');

  // Thresholds & Settings
  const approveThreshold = await readSetting('autoAnswerApproveThreshold', 0.85, batchId);
  const suggestThreshold = await readSetting('autoAnswerSuggestThreshold', 0.60, batchId);
  const minConfidence = await readSetting('autoAnswerMinConfidence', 0.35, batchId);
  const faqDuplicateThreshold = await readSetting('faqDuplicateThreshold', 0.82, batchId);
  const batchSize = await readSetting('autoAnswerBatchSize', 20, batchId);
  const minAgeHours = await readSetting('autoAnswerMinAgeHours', 2, batchId);
  const goldenCooldown = await readSetting('goldenCooldownHours', 48, batchId);
  const goldenPenalty = await readSetting('goldenPenaltyMultiplier', 1.25, batchId);

  // Feature Flags
  const sessionSupport = await isFeatureEnabledLocal('sessionSupport', batchId);
  const goldenTicket = await isFeatureEnabledLocal('goldenTicket', batchId);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚙️ Yaksha Administrative Dashboard')
    .setDescription(`Configuration dashboard for ${batchId ? `Program/Batch \`${batchId}\`` : 'Global defaults'}`)
    .addFields(
      {
        name: '🤖 AI Config',
        value: `**Active Provider**: \`${aiConfig?.activeProvider ?? 'anthropic'}\`\n\n**API Keys configured**:\n${keyStatus}`,
        inline: true
      },
      {
        name: '📊 Thresholds & Limits',
        value: [
          `**Approve Score**: \`${approveThreshold}\``,
          `**Suggest Score**: \`${suggestThreshold}\``,
          `**Min Confidence**: \`${minConfidence}\``,
          `**FAQ Duplicate**: \`${faqDuplicateThreshold}\``,
          `**Batch Size**: \`${batchSize}\``,
          `**Min Post Age**: \`${minAgeHours} hours\``,
          `**Golden Cooldown**: \`${goldenCooldown} hours\``,
          `**Golden Penalty**: \`${goldenPenalty}x\``,
        ].join('\n'),
        inline: true
      },
      {
        name: '⚙️ Feature Flags',
        value: [
          `**Session Support**: ${sessionSupport ? '✅ Enabled' : '❌ Disabled'}`,
          `**Golden Ticket**: ${goldenTicket ? '✅ Enabled' : '❌ Disabled'}`,
        ].join('\n'),
        inline: false
      }
    )
    .setFooter({ text: 'Use buttons below to edit dynamically' })
    .setTimestamp();

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('admin_config_btn_set_key').setLabel('🔑 Set API Key').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_config_btn_set_threshold').setLabel('📊 Set Threshold').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_config_btn_set_flag').setLabel('⚙️ Toggle Feature Flag').setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('admin_config_btn_set_provider').setLabel('🤖 Set AI Provider').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_config_btn_refresh').setLabel('🔄 Refresh View').setStyle(ButtonStyle.Secondary)
  );

  return { embed, components: [row1, row2] };
}

/** Helper feature checker local to command to avoid potential controller imports dependency */
async function isFeatureEnabledLocal(key: string, batchId: string | null = null): Promise<boolean> {
  try {
    const flag = await FeatureFlag.findOne({
      key,
      $or: [
        ...(batchId ? [{ batchId: new mongoose.Types.ObjectId(batchId) }] : []),
        { batchId: null },
      ],
    })
      .sort({ batchId: -1 })
      .select('enabled')
      .lean();
    return !!(flag && flag.enabled);
  } catch {
    return false;
  }
}

export async function executeAdminConfig(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  batchId: string | null = null
): Promise<void> {
  if (!isAdmin(interaction, config)) {
    await interaction.reply({ content: '🔒 Access denied: Admin only', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const { embed, components } = await buildDashboard(batchId);
  await interaction.followUp({ embeds: [embed], components, ephemeral: true });
}

/** Route Button Interaction clicks */
export async function handleAdminConfigButton(
  interaction: ButtonInteraction,
  config: BotConfig,
  batchId: string | null = null
): Promise<void> {
  if (!isAdmin(interaction, config)) {
    await interaction.reply({ content: '🔒 Access denied: Admin only', ephemeral: true });
    return;
  }

  const customId = interaction.customId;

  if (customId === 'admin_config_btn_refresh') {
    await interaction.deferUpdate();
    const { embed, components } = await buildDashboard(batchId);
    await interaction.editReply({ embeds: [embed], components });
    return;
  }

  if (customId === 'admin_config_btn_set_key') {
    const modal = new ModalBuilder()
      .setCustomId('admin_config_modal_set_key')
      .setTitle('Configure AI API Key');

    const providerInput = new TextInputBuilder()
      .setCustomId('provider')
      .setLabel('Provider (anthropic/openai/xai/gemini)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. openai')
      .setRequired(true);

    const keyInput = new TextInputBuilder()
      .setCustomId('api_key')
      .setLabel('API Key')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Paste key here...')
      .setRequired(true);

    const passphraseInput = new TextInputBuilder()
      .setCustomId('passphrase')
      .setLabel('Admin Passphrase')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter confirmation passphrase')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(providerInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(keyInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(passphraseInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (customId === 'admin_config_btn_set_threshold') {
    const modal = new ModalBuilder()
      .setCustomId('admin_config_modal_set_threshold')
      .setTitle('Update Setting / Threshold');

    const settingInput = new TextInputBuilder()
      .setCustomId('setting')
      .setLabel('Setting Name')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. autoAnswerApproveThreshold, autoAnswerSuggestThreshold, autoAnswerMinConfidence, faqDuplicateThreshold, autoAnswerBatchSize, autoAnswerMinAgeHours, goldenCooldownHours, goldenPenaltyMultiplier')
      .setRequired(true);

    const valueInput = new TextInputBuilder()
      .setCustomId('value')
      .setLabel('New Value')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter number or value')
      .setRequired(true);

    const passphraseInput = new TextInputBuilder()
      .setCustomId('passphrase')
      .setLabel('Admin Passphrase')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter confirmation passphrase')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(settingInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(valueInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(passphraseInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (customId === 'admin_config_btn_set_flag') {
    const modal = new ModalBuilder()
      .setCustomId('admin_config_modal_set_flag')
      .setTitle('Toggle Feature Flag');

    const flagInput = new TextInputBuilder()
      .setCustomId('flag')
      .setLabel('Feature Flag Key (sessionSupport/goldenTicket)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. goldenTicket')
      .setRequired(true);

    const valueInput = new TextInputBuilder()
      .setCustomId('value')
      .setLabel('Enabled (true / false)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('true or false')
      .setRequired(true);

    const passphraseInput = new TextInputBuilder()
      .setCustomId('passphrase')
      .setLabel('Admin Passphrase')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter confirmation passphrase')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(flagInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(valueInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(passphraseInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (customId === 'admin_config_btn_set_provider') {
    const modal = new ModalBuilder()
      .setCustomId('admin_config_modal_set_provider')
      .setTitle('Update Active AI Provider');

    const providerInput = new TextInputBuilder()
      .setCustomId('provider')
      .setLabel('Active Provider')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. anthropic, openai, xai, gemini')
      .setRequired(true);

    const passphraseInput = new TextInputBuilder()
      .setCustomId('passphrase')
      .setLabel('Admin Passphrase')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter confirmation passphrase')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(providerInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(passphraseInput)
    );

    await interaction.showModal(modal);
    return;
  }
}

/** Handle Modal Submissions */
export async function handleAdminConfigModal(
  interaction: ModalSubmitInteraction,
  config: BotConfig,
  batchId: string | null = null
): Promise<void> {
  if (!isAdmin(interaction, config)) {
    await interaction.reply({ content: '🔒 Access denied: Admin only', ephemeral: true });
    return;
  }

  const customId = interaction.customId;
  const passphrase = interaction.fields.getTextInputValue('passphrase');

  // Verify passphrase
  if (passphrase !== config.adminPassphrase) {
    await interaction.reply({ embeds: [errorEmbed('Passphrase verification failed. Action unauthorized.')], ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (customId === 'admin_config_modal_set_key') {
      const provider = interaction.fields.getTextInputValue('provider').trim().toLowerCase() as AIProviderType;
      const apiKey = interaction.fields.getTextInputValue('api_key').trim();

      const validProviders: AIProviderType[] = ['anthropic', 'openai', 'xai', 'minimax', 'gemini', 'custom'];
      if (!validProviders.includes(provider)) {
        throw new Error(`Invalid provider: must be one of ${validProviders.join(', ')}`);
      }

      let aiConfig = await AiConfig.findOne({ batchId: batchId || null, isActive: true });
      if (!aiConfig) {
        aiConfig = await AiConfig.create({
          batchId: batchId || null,
          activeProvider: 'anthropic',
          providers: {
            anthropic: { apiKeyCipher: '', baseURL: '', model: '' },
            openai:    { apiKeyCipher: '', baseURL: '', model: '' },
            xai:       { apiKeyCipher: '', baseURL: '', model: '' },
            minimax:   { apiKeyCipher: '', baseURL: '', model: '' },
            gemini:    { apiKeyCipher: '', baseURL: '', model: '' },
            custom:    { apiKeyCipher: '', baseURL: '', model: '' },
          },
          isActive: true
        });
      }

      aiConfig.setApiKey(provider, apiKey);
      await aiConfig.save();
      invalidateProviderCache();

      await interaction.followUp({ content: `✅ Securely configured API key for AI provider **${provider.toUpperCase()}**.`, ephemeral: true });
      return;
    }

    if (customId === 'admin_config_modal_set_provider') {
      const provider = interaction.fields.getTextInputValue('provider').trim().toLowerCase() as AIProviderType;
      const validProviders: AIProviderType[] = ['anthropic', 'openai', 'xai', 'minimax', 'gemini', 'custom'];

      if (!validProviders.includes(provider)) {
        throw new Error(`Invalid provider: must be one of ${validProviders.join(', ')}`);
      }

      let aiConfig = await AiConfig.findOne({ batchId: batchId || null, isActive: true });
      if (!aiConfig) {
        aiConfig = await AiConfig.create({
          batchId: batchId || null,
          activeProvider: provider,
          isActive: true
        });
      } else {
        aiConfig.activeProvider = provider;
        await aiConfig.save();
      }
      invalidateProviderCache();

      await interaction.followUp({ content: `✅ Set active AI Provider to **${provider.toUpperCase()}**.`, ephemeral: true });
      return;
    }

    if (customId === 'admin_config_modal_set_threshold') {
      const settingName = interaction.fields.getTextInputValue('setting').trim() as SettingKey;
      const rawValue = interaction.fields.getTextInputValue('value').trim();

      const validKeys: SettingKey[] = [
        'goldenCooldownHours',
        'goldenPenaltyMultiplier',
        'zoomPassScore',
        'zoomQuestionCount',
        'zoomTranscript',
        'zoomUrl',
        'zoomTitle',
        'zoomDescription',
        'zoomDuration',
        'zoomActive',
        'zoomDailyResetTime',
        'autoAnswerApproveThreshold',
        'autoAnswerSuggestThreshold',
        'autoAnswerMinConfidence',
        'autoAnswerBatchSize',
        'autoAnswerMinAgeHours',
        'faqDuplicateThreshold'
      ];

      if (!validKeys.includes(settingName)) {
        throw new Error(`Invalid setting name. Must be one of:\n${validKeys.join(', ')}`);
      }

      // Convert value appropriately
      let value: string | number | boolean = rawValue;
      if (settingName === 'zoomActive') {
        value = rawValue.toLowerCase() === 'true';
      } else if (!isNaN(Number(rawValue))) {
        value = Number(rawValue);
      }

      if (batchId) {
        // Update per-program override in ProgramConfig
        // Map settings to fields in IProgramAppSettings if they are defined
        const validProgramKeys = [
          'goldenCooldownHours',
          'goldenPenaltyMultiplier',
          'goldenSpCost',
          'autoAnswerApproveThreshold',
          'autoAnswerSuggestThreshold',
          'autoAnswerMinConfidence',
          'autoAnswerBatchSize',
          'autoAnswerMinAgeHours',
          'faqDuplicateThreshold'
        ];

        let configKey = settingName as string;
        if (settingName === 'goldenCooldownHours') configKey = 'goldenTicketCooldownHours';
        if (settingName === 'goldenPenaltyMultiplier') configKey = 'penaltyMultiplier';

        if (validProgramKeys.includes(configKey)) {
          await ProgramConfig.findOneAndUpdate(
            { batchId: new mongoose.Types.ObjectId(batchId) },
            { $set: { [`appSettings.${configKey}`]: value } },
            { upsert: true }
          );
          invalidateProgramAppSettingsCache(batchId);
        } else {
          throw new Error(`Setting \`${settingName}\` is not overrideable per program. Edit it globally.`);
        }
      } else {
        // Update globally in AppSetting
        await AppSetting.findOneAndUpdate(
          { _id: 'singleton' },
          { $set: { [`settings.${settingName}`]: value } },
          { upsert: true }
        );
      }

      await interaction.followUp({ content: `✅ Updated setting \`${settingName}\` to \`${value}\`${batchId ? ` for program \`${batchId}\`` : ' globally'}.`, ephemeral: true });
      return;
    }

    if (customId === 'admin_config_modal_set_flag') {
      const flagKey = interaction.fields.getTextInputValue('flag').trim();
      const rawValue = interaction.fields.getTextInputValue('value').trim().toLowerCase();

      if (flagKey !== 'sessionSupport' && flagKey !== 'goldenTicket') {
        throw new Error('Invalid feature flag. Supported flags: `sessionSupport`, `goldenTicket`');
      }

      const isEnabled = rawValue === 'true' || rawValue === 'yes' || rawValue === '1';

      await ensureFlag(flagKey);
      await FeatureFlag.findOneAndUpdate(
        { key: flagKey, batchId: batchId ? new mongoose.Types.ObjectId(batchId) : null },
        {
          $set: {
            enabled: isEnabled,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      invalidateFeatureFlagCache(flagKey);

      await interaction.followUp({ content: `✅ Updated feature flag \`${flagKey}\` to **${isEnabled ? 'ENABLED' : 'DISABLED'}**${batchId ? ` for program \`${batchId}\`` : ' globally'}.`, ephemeral: true });
      return;
    }
  } catch (err) {
    await interaction.followUp({ embeds: [errorEmbed((err as Error).message)], ephemeral: true });
  }
}
