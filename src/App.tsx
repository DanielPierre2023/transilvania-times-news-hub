import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import GDPRConsent from "@/components/GDPRConsent";
import Index from "./pages/Index.tsx";
import Article from "./pages/Article.tsx";
import Category from "./pages/Category.tsx";
import SearchResults from "./pages/SearchResults.tsx";
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
import ComingSoon from "./pages/admin/ComingSoon.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/article/:slug" element={<Article />} />
          <Route path="/category/:name" element={<Category />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/terms" element={<TermsConditions />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />

          {/* Admin routes */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="analytics" element={<ComingSoon />} />
            <Route path="blog" element={<ComingSoon />} />
            <Route path="blog/new" element={<ComingSoon />} />
            <Route path="blog/:id" element={<ComingSoon />} />
            <Route path="comments" element={<ComingSoon />} />
            <Route path="rss" element={<ComingSoon />} />
            <Route path="newsletter" element={<ComingSoon />} />
            <Route path="subscribers" element={<ComingSoon />} />
            <Route path="contacts" element={<ComingSoon />} />
            <Route path="conversations" element={<ComingSoon />} />
            <Route path="reports" element={<ComingSoon />} />
            <Route path="geo" element={<ComingSoon />} />
            <Route path="inbox" element={<ComingSoon />} />
            <Route path="settings" element={<ComingSoon />} />
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
