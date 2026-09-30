import { useState, type FormEvent } from "react";
import type { ApiClient } from "../../../lib/api";
import type { FlashMessage } from "../../../lib/types";
import {
  parseNewsletterTrialRecipients,
  type NewsletterBodyFormat
} from "./adminSettingsDrafts";
import type {
  AnnouncementSummary,
  NewsletterCampaignSummary,
  NewsletterCampaignsResponse,
  SubscriptionPlan,
  SubscriptionPlanInput,
  SubscriptionPlansResponse
} from "./shared";

interface PublishingSnapshot {
  plans: SubscriptionPlan[];
  campaigns: NewsletterCampaignSummary[];
  announcements: AnnouncementSummary[];
}

interface UseAdminPublishingSettingsInput {
  api: ApiClient;
  setError: (error: string | null) => void;
  setFlash: (flash: FlashMessage | null) => void;
}

function useAdminSubscriptionPlans(input: UseAdminPublishingSettingsInput) {
  const { api, setError, setFlash } = input;
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [isPlanSaving, setIsPlanSaving] = useState(false);

  async function reloadSubscriptionPlans(): Promise<void> {
    const response = await api.get<SubscriptionPlansResponse>("/api/admin/subscriptions/plans");
    setPlans(response.plans);
  }

  async function createPlan(plan: SubscriptionPlanInput): Promise<void> {
    setError(null);
    setIsPlanSaving(true);
    try {
      await api.post("/api/admin/subscriptions/plans", { ...plan, isActive: true });
      await reloadSubscriptionPlans();
      setFlash({ tone: "success", text: "Subscription plan created." });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setIsPlanSaving(false);
    }
  }

  async function editPlan(planId: string, plan: SubscriptionPlanInput): Promise<void> {
    setError(null);
    setIsPlanSaving(true);
    try {
      await api.patch(`/api/admin/subscriptions/plans/${planId}`, plan);
      await reloadSubscriptionPlans();
      setFlash({ tone: "success", text: "Subscription plan updated." });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setIsPlanSaving(false);
    }
  }

  async function togglePlanActive(plan: SubscriptionPlan): Promise<void> {
    setError(null);
    setIsPlanSaving(true);
    try {
      await api.patch(`/api/admin/subscriptions/plans/${plan.id}`, { isActive: !plan.isActive });
      await reloadSubscriptionPlans();
      setFlash({ tone: "success", text: "Subscription plan updated." });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsPlanSaving(false);
    }
  }

  return {
    plans,
    setPlans,
    isPlanSaving,
    createPlan,
    editPlan,
    togglePlanActive
  };
}

function useAdminAnnouncements(input: UseAdminPublishingSettingsInput) {
  const { api, setError, setFlash } = input;
  const [announcements, setAnnouncements] = useState<AnnouncementSummary[]>([]);
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [announcementNotify, setAnnouncementNotify] = useState(false);
  const [isAnnouncementSaving, setIsAnnouncementSaving] = useState(false);

  async function reloadAnnouncements(): Promise<void> {
    const response = await api.get<{ announcements: AnnouncementSummary[] }>("/api/announcements");
    setAnnouncements(response.announcements);
  }

  async function createAnnouncement(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!announcementTitle.trim() || !announcementBody.trim()) {
      setError("Title and body are required.");
      return;
    }
    setIsAnnouncementSaving(true);
    try {
      await api.post("/api/admin/announcements", {
        title: announcementTitle.trim(),
        body: announcementBody.trim(),
        notify: announcementNotify
      });
      setAnnouncementTitle("");
      setAnnouncementBody("");
      setAnnouncementNotify(false);
      await reloadAnnouncements();
      setFlash({ tone: "success", text: "Announcement created." });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAnnouncementSaving(false);
    }
  }

  async function deleteAnnouncement(id: string): Promise<void> {
    try {
      await api.delete(`/api/admin/announcements/${id}`);
      await reloadAnnouncements();
      setFlash({ tone: "success", text: "Announcement deleted." });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    announcements,
    setAnnouncements,
    announcementTitle,
    setAnnouncementTitle,
    announcementBody,
    setAnnouncementBody,
    announcementNotify,
    setAnnouncementNotify,
    isAnnouncementSaving,
    createAnnouncement,
    deleteAnnouncement
  };
}

function useAdminNewsletter(input: UseAdminPublishingSettingsInput) {
  const { api, setError, setFlash } = input;
  const [campaigns, setCampaigns] = useState<NewsletterCampaignSummary[]>([]);
  const [newsletterSubject, setNewsletterSubject] = useState("");
  const [newsletterBodyFormat, setNewsletterBodyFormat] = useState<NewsletterBodyFormat>("markdown");
  const [newsletterMarkdownBody, setNewsletterMarkdownBody] = useState("");
  const [newsletterHtmlBody, setNewsletterHtmlBody] = useState("");
  const [newsletterTrialRecipients, setNewsletterTrialRecipients] = useState("");
  const [isNewsletterSending, setIsNewsletterSending] = useState(false);
  const [isNewsletterTrialSending, setIsNewsletterTrialSending] = useState(false);
  const newsletterBody = newsletterBodyFormat === "markdown" ? newsletterMarkdownBody : newsletterHtmlBody;

  async function reloadNewsletterCampaigns(): Promise<void> {
    const response = await api.get<NewsletterCampaignsResponse>("/api/admin/newsletters");
    setCampaigns(response.campaigns);
  }

  async function sendNewsletter(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!newsletterSubject.trim() || !newsletterBody.trim()) {
      setError("Newsletter subject and body are required.");
      return;
    }

    setError(null);
    setIsNewsletterSending(true);
    try {
      await api.post("/api/admin/newsletters/send", {
        subject: newsletterSubject.trim(),
        body: newsletterBody.trim(),
        bodyFormat: newsletterBodyFormat
      });
      setNewsletterSubject("");
      setNewsletterMarkdownBody("");
      setNewsletterHtmlBody("");
      await reloadNewsletterCampaigns();
      setFlash({ tone: "success", text: "Newsletter queued for delivery." });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsNewsletterSending(false);
    }
  }

  async function sendTrialNewsletter(): Promise<void> {
    const recipientEmails = parseNewsletterTrialRecipients(newsletterTrialRecipients);
    if (!newsletterSubject.trim() || !newsletterBody.trim()) {
      setError("Newsletter subject and body are required.");
      return;
    }
    if (recipientEmails.length === 0) {
      setError("Add at least one trial recipient email.");
      return;
    }

    setError(null);
    setIsNewsletterTrialSending(true);
    try {
      const result = await api.post<{ queuedCount: number }>("/api/admin/newsletters/trial", {
        subject: newsletterSubject.trim(),
        body: newsletterBody.trim(),
        bodyFormat: newsletterBodyFormat,
        recipientEmails
      });
      setFlash({
        tone: "success",
        text: `Trial newsletter queued for ${result.queuedCount} recipient${result.queuedCount === 1 ? "" : "s"}.`
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsNewsletterTrialSending(false);
    }
  }

  return {
    campaigns,
    setCampaigns,
    newsletterSubject,
    setNewsletterSubject,
    newsletterBodyFormat,
    setNewsletterBodyFormat,
    newsletterMarkdownBody,
    setNewsletterMarkdownBody,
    newsletterHtmlBody,
    setNewsletterHtmlBody,
    newsletterTrialRecipients,
    setNewsletterTrialRecipients,
    isNewsletterSending,
    isNewsletterTrialSending,
    reloadNewsletterCampaigns,
    sendNewsletter,
    sendTrialNewsletter
  };
}

export function useAdminPublishingSettings(input: UseAdminPublishingSettingsInput) {
  const subscriptions = useAdminSubscriptionPlans(input);
  const newsletter = useAdminNewsletter(input);
  const announcements = useAdminAnnouncements(input);

  function applyPublishingSnapshot(snapshot: PublishingSnapshot): void {
    subscriptions.setPlans(snapshot.plans);
    newsletter.setCampaigns(snapshot.campaigns);
    announcements.setAnnouncements(snapshot.announcements);
  }

  return {
    ...subscriptions,
    ...newsletter,
    ...announcements,
    applyPublishingSnapshot
  };
}
