
import React from "react";
import SummaryForm from "./SummaryForm";

const SummaryContent: React.FC = () => {
  return (
    <div className="flex flex-col ml-5 w-full max-md:ml-0 max-md:w-full">
      <div className="flex flex-col -mt-2 w-full max-md:mt-10 max-md:max-w-full">
        <div className="flex flex-wrap text-3xl font-bold text-black max-md:max-w-full">
          <img
            loading="lazy"
            src="https://cdn.builder.io/api/v1/image/assets/93d2ce464c974b218c79fed255362336/3792afe31718df9ce0bfc6c8459a56bccc22647326fe60fa1d86263a67db5086?apiKey=93d2ce464c974b218c79fed255362336&"
            alt=""
            className="object-contain shrink-0 my-auto aspect-square w-5"
          />

          <div className="flex flex-col grow shrink-0 items-start pb-2.5 basis-0 min-h-[98px] w-fit max-md:max-w-full">
            <div className="max-w-full rounded-none w-[812px] max-md:pr-5">
              Narrative deposition summary
            </div>
          </div>
        </div>

        <div className="flex flex-col items-start pl-5 w-full text-base max-md:max-w-full">
          <div className="flex shrink-0 self-stretch h-px bg-slate-500 bg-opacity-50 max-md:max-w-full" />
          <div className="mt-8 text-black max-md:max-w-full">
            The narrative deposition summary condenses and outlines the
            overview, key topics, injuries, liability, damages and witnesses
            presented during the deposition. This summary is designed to provide
            attorneys, legal teams, and relevant parties with a concise,
            easy-to-understand overview of the deposition content without
            needing to sift through hours of testimony or pages of transcripts.
          </div>
          <div className="flex gap-3 mt-12 text-black max-md:mt-10">
            <div className="basis-auto">Example outputs:</div>
            <div className="font-semibold">Word</div>
            <div className="font-bold">PDF</div>
          </div>
          <SummaryForm />
        </div>
      </div>
    </div>
  );
};

export default SummaryContent;
