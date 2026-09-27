export type Sample = {
  title: string;
  year: string;
  accent: string;
};

export function SamplePosterCard(props: {
  sample: Sample;
  small?: boolean;
}) {
  const { sample, small = false } = props;
  const className = small ? "sample-poster small" : "sample-poster";

  return (
    <div className={className} style={{ background: sample.accent }}>
      <div className="sample-poster-shade" />
      <div className="sample-poster-content">
        <span>Featured</span>
        <strong>{sample.title}</strong>
        <small>{sample.year}</small>
      </div>
    </div>
  );
}
