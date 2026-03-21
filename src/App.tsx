import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import GDPRConsent from "@/components/GDPRConsent";
import AnalyticsWrapper from "@/components/AnalyticsWrapper";
import Index from "./pages/Index.tsx";
import Article from "./pages/Article.tsx";
import Category from "./pages/Category.tsx";
import SearchResults from "./pages/SearchResults.tsx";
import Blog from "./pages/Blog.tsx";
import BlogPost from "./pages/BlogPost.tsx";
import TermsConditions from "./pages/TermsConditions.tsx";
import PrivacyPolicy from "./pages/PrivacyPolicy.tsx";
import Contact from "./pages/Contact.tsx";
import NotFound from "./pages/NotFound.tsx";

// Admin pages
import AdminLogin from "./pages/admin/AdminLogin.tsx";
import AdminLayout from "./pages/admin/AdminLayout.tsx";
import Dashboard from "./pages/admin/Dashboard.tsx";
import BlogManager from "./pages/admin/BlogManager.tsx";
import BlogEditor from "./pages/admin/BlogEditor.tsx";
import Analytics from "./pages/admin/Analytics.tsx";
import CommentsManager from "./pages/admin/CommentsManager.tsx";
import ContactsPage from "./pages/admin/ContactsPage.tsx";
import GeoToolsPage from "./pages/admin/GeoToolsPage.tsx";
import InboxPage from "./pages/admin/InboxPage.tsx";
import AdminNewsletter from "./pages/admin/Newsletter.tsx";
import RssScraper from "./pages/admin/RssScraper.tsx";

import Subscribers from "./pages/admin/Subscribers.tsx";
import SettingsPage from "./pages/admin/SettingsPage.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AnalyticsWrapper />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/article/:slug" element={<Article />} />
          <Route path="/category/:name" element={<Category />} />
          <Route path="/category/:name/:sub" element={<Category />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/terms" element={<TermsConditions />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />

          {/* Admin routes */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="blog" element={<BlogManager />} />
            <Route path="blog/new" element={<BlogEditor />} />
            <Route path="blog/:id" element={<BlogEditor />} />
            <Route path="comments" element={<CommentsManager />} />
            <Route path="rss" element={<RssScraper />} />
            <Route path="newsletter" element={<AdminNewsletter />} />
            <Route path="subscribers" element={<Subscribers />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="geo" element={<GeoToolsPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        <GDPRConsent />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
